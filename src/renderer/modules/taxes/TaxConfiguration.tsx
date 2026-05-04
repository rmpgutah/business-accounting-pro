import React, { useState, useEffect, useCallback } from 'react';
import {
  Calculator, ChevronDown, RefreshCw, CheckCircle, Plus,
  DollarSign, Percent, AlertCircle, TrendingUp, Settings,
  Clock, Calendar, FileText, Shield,
} from 'lucide-react';
import { formatCurrency, formatDate } from '../../lib/format';

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

type FilingStatus = 'single' | 'married_filing_jointly' | 'married_filing_separately' | 'head_of_household';

interface WithholdingResult {
  federal: number;
  ss: number;
  medicare: number;
  total: number;
}

// ─── Helpers ─────────────────────────────────────────────
const CURRENT_YEAR = 2026;

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

// Alphabetical A→Z by label
const FILING_TABS: { key: FilingStatus; label: string }[] = [
  { key: 'head_of_household', label: 'Head of Household' },
  { key: 'married_filing_jointly', label: 'Married Filing Jointly' },
  { key: 'married_filing_separately', label: 'Married Filing Separately' },
  { key: 'single', label: 'Single' },
];

// ─── Toast ───────────────────────────────────────────────
interface Toast { id: number; msg: string; ok: boolean }
let _tid = 0;

// ─── PrefRow ─────────────────────────────────────────────
const PrefRow: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div className="flex items-start justify-between gap-4 py-2 border-b border-border-primary last:border-b-0">
    <div className="flex-1">
      <div className="text-sm font-medium text-text-primary">{label}</div>
      {hint && <div className="text-[10px] text-text-muted mt-0.5">{hint}</div>}
    </div>
    <div style={{ minWidth: '200px' }}>{children}</div>
  </div>
);

// ─── Toggle ──────────────────────────────────────────────
const PrefToggle: React.FC<{ value: boolean; onChange: (v: boolean) => void }> = ({ value, onChange }) => (
  <label className="flex items-center gap-2 cursor-pointer">
    <input
      type="checkbox"
      checked={value}
      onChange={(e) => onChange(e.target.checked)}
      className="w-4 h-4 accent-accent-blue"
    />
    <span className="text-xs text-text-secondary">{value ? 'Enabled' : 'Disabled'}</span>
  </label>
);

// ─── Deadline computation for mini calendar ──────────────
function getNextDeadlines(year: number): Array<{ label: string; dueDate: string; daysUntil: number }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dates = [
    { label: '941 / TC-941 Q1', month: 3, day: 30, yr: year },
    { label: '941 / TC-941 Q2', month: 6, day: 31, yr: year },
    { label: '941 / TC-941 Q3', month: 9, day: 31, yr: year },
    { label: '941 / TC-941 Q4', month: 0, day: 31, yr: year + 1 },
    { label: 'FUTA 940', month: 0, day: 31, yr: year + 1 },
    { label: 'W-2 / W-3', month: 0, day: 31, yr: year + 1 },
  ];

  return dates
    .map((d) => {
      const due = new Date(d.yr, d.month, d.day);
      const daysUntil = Math.ceil((due.getTime() - today.getTime()) / 86_400_000);
      return { label: d.label, dueDate: due.toISOString().slice(0, 10), daysUntil };
    })
    .filter((d) => d.daysUntil > 0)
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, 4);
}

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

  // Tax preferences
  const [prefs, setPrefs] = useState<Record<string, string>>({});
  const [prefsLoading, setPrefsLoading] = useState(true);

  const showToast = (msg: string, ok = true) => {
    const t = { id: ++_tid, msg, ok };
    setToast(t);
    setTimeout(() => setToast((c) => (c?.id === t.id ? null : c)), 4000);
  };

  // Load preferences
  useEffect(() => {
    setPrefsLoading(true);
    window.electronAPI.invoke('settings:list')
      .then((rows: Array<{ key: string; value: string }>) => {
        const map: Record<string, string> = {};
        (rows || []).forEach((r) => { map[r.key] = r.value; });
        setPrefs(map);
      })
      .catch(() => {})
      .finally(() => setPrefsLoading(false));
  }, []);

  const savePref = async (key: string, value: string) => {
    try {
      await window.electronAPI.invoke('settings:set', { key, value });
      setPrefs((p) => ({ ...p, [key]: value }));
    } catch {
      showToast(`Failed to save ${key}`, false);
    }
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

  // On mount: load years, auto-seed all available years (2024-2026)
  useEffect(() => {
    const init = async () => {
      const years = await loadYears();
      const yearsToSeed = [2024, 2025, 2026].filter(y => !years.includes(y));
      if (yearsToSeed.length > 0) {
        for (const y of yearsToSeed) {
          await seedYear(y, true);
        }
        setAutoSeeded(true);
        await loadYears();
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

  // Mini calendar deadlines
  const miniDeadlines = getNextDeadlines(selectedYear);

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
                      : 'text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors'
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
          Tax data for {selectedYear} has not been seeded. Click &quot;Seed {selectedYear}&quot; to initialize with default federal tax rates.
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
                      : 'border-transparent text-text-muted hover:text-text-primary transition-colors'
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

          {/* IRS Reference Rates + Per Diem + W-4 Version + Calendar */}
          <div className="grid grid-cols-2 gap-4">
            {/* IRS Rates & Per Diem */}
            <div className="block-card p-4" style={{ borderRadius: '6px' }}>
              <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider border-b border-border-primary pb-2 mb-4">
                IRS Reference Rates — {selectedYear}
              </h3>
              <div className="space-y-3">
                <div className="flex items-start gap-2 p-2 bg-bg-tertiary border border-border-primary" style={{ borderRadius: '6px' }}>
                  <DollarSign size={13} className="text-accent-blue mt-0.5" />
                  <div>
                    <p className="text-xs text-text-muted">Standard Mileage Rate</p>
                    <p className="text-sm font-semibold text-text-primary">$0.70/mile</p>
                    <p className="text-[10px] text-text-muted mt-0.5">Business use of personal vehicle</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 p-2 bg-bg-tertiary border border-border-primary" style={{ borderRadius: '6px' }}>
                  <DollarSign size={13} className="text-accent-warning mt-0.5" />
                  <div>
                    <p className="text-xs text-text-muted">Per Diem — Meals</p>
                    <p className="text-sm font-semibold text-text-primary">$59.00/day</p>
                    <p className="text-[10px] text-text-muted mt-0.5">Federal M&IE rate (standard CONUS)</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 p-2 bg-bg-tertiary border border-border-primary" style={{ borderRadius: '6px' }}>
                  <DollarSign size={13} className="text-accent-expense mt-0.5" />
                  <div>
                    <p className="text-xs text-text-muted">Per Diem — Lodging</p>
                    <p className="text-sm font-semibold text-text-primary">Varies by locality</p>
                    <p className="text-[10px] text-text-muted mt-0.5">$107 standard CONUS / higher for high-cost areas</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 p-2 bg-bg-tertiary border border-border-primary" style={{ borderRadius: '6px' }}>
                  <FileText size={13} className="text-accent-income mt-0.5" />
                  <div>
                    <p className="text-xs text-text-muted">W-4 Form Version</p>
                    <p className="text-sm font-semibold text-text-primary">2020+ Redesigned W-4</p>
                    <p className="text-[10px] text-text-muted mt-0.5">No allowances — uses income, deductions, credits. Legacy W-4 (pre-2020) still valid for existing employees who have not updated.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Tax Calendar Quick Reference */}
            <div className="block-card p-4" style={{ borderRadius: '6px' }}>
              <div className="flex items-center gap-2 mb-4 pb-2 border-b border-border-primary">
                <Calendar size={15} className="text-accent-blue" />
                <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider">
                  Tax Calendar — {selectedYear}
                </h3>
              </div>
              {miniDeadlines.length > 0 ? (
                <div className="space-y-3">
                  {miniDeadlines.map((d, i) => (
                    <div key={i} className="flex items-center gap-3 p-2 bg-bg-tertiary border border-border-primary" style={{ borderRadius: '6px' }}>
                      <div className={`w-2 h-2 shrink-0 ${d.daysUntil <= 14 ? 'bg-accent-expense' : d.daysUntil <= 60 ? 'bg-accent-warning' : 'bg-accent-income'}`} style={{ borderRadius: '6px' }} />
                      <div className="flex-1">
                        <div className="text-xs font-medium text-text-primary">{d.label}</div>
                        <div className="text-[10px] text-text-muted">{formatDate(d.dueDate)}</div>
                      </div>
                      <span className={`text-xs font-semibold ${d.daysUntil <= 14 ? 'text-accent-expense' : 'text-text-muted'}`}>
                        {d.daysUntil}d
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-text-muted">No upcoming deadlines for {selectedYear}.</p>
              )}
            </div>
          </div>

          {/* Tax Preferences & Settings */}
          <div className="block-card p-5" style={{ borderRadius: '6px' }}>
            <div className="flex items-center gap-2 mb-4 pb-2 border-b border-border-primary">
              <Settings size={15} className="text-accent-blue" />
              <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider">
                Tax Preferences & Settings
              </h3>
            </div>

            {prefsLoading ? (
              <div className="text-xs text-text-muted py-4 text-center">Loading preferences...</div>
            ) : (
              <div className="space-y-0">
                {/* Tax Rounding Method (#22) */}
                <PrefRow label="Tax Rounding Method" hint="How to round calculated tax amounts">
                  <select
                    className="block-select w-full"
                    value={prefs.tax_rounding || 'nearest'}
                    onChange={(e) => savePref('tax_rounding', e.target.value)}
                  >
                    <option value="nearest">Round to Nearest Cent</option>
                    <option value="up">Always Round Up</option>
                    <option value="down">Always Round Down</option>
                    <option value="bankers">Banker&apos;s Rounding</option>
                  </select>
                </PrefRow>

                {/* Deposit Schedule (#23) */}
                <PrefRow label="Deposit Schedule" hint="Federal tax deposit frequency based on lookback period liability">
                  <div className="flex items-center gap-3">
                    {['Monthly', 'Semi-Weekly', 'Next-Day'].map((opt) => (
                      <label key={opt} className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="deposit_schedule"
                          value={opt}
                          checked={(prefs.deposit_schedule || 'Monthly') === opt}
                          onChange={() => savePref('deposit_schedule', opt)}
                          className="w-3.5 h-3.5 accent-accent-blue"
                        />
                        <span className="text-xs text-text-secondary">{opt}</span>
                      </label>
                    ))}
                  </div>
                </PrefRow>

                {/* Filing Reminder Days (#24) */}
                <PrefRow label="Filing Reminder Days" hint="Days before deadline to trigger reminders (comma-separated)">
                  <input
                    type="text"
                    className="block-input w-full"
                    value={prefs.filing_reminder_days || '30,14,7'}
                    onChange={(e) => savePref('filing_reminder_days', e.target.value)}
                    placeholder="30,14,7"
                  />
                </PrefRow>

                {/* Auto-Seed New Tax Year (#25) */}
                <PrefRow label="Auto-Seed New Tax Year" hint="Automatically populate brackets when a new tax year starts">
                  <PrefToggle
                    value={prefs.auto_seed_year === 'true'}
                    onChange={(v) => savePref('auto_seed_year', String(v))}
                  />
                </PrefRow>

                {/* Show Employer Cost on Stubs (#26) */}
                <PrefRow label="Show Employer Cost on Stubs" hint="Display employer-paid taxes on employee pay stubs">
                  <PrefToggle
                    value={prefs.show_employer_cost === 'true'}
                    onChange={(v) => savePref('show_employer_cost', String(v))}
                  />
                </PrefRow>

                {/* Default W-2 Distribution (#27) */}
                <PrefRow label="Default W-2 Distribution" hint="How W-2 forms are distributed to employees">
                  <select
                    className="block-select w-full"
                    value={prefs.w2_distribution || 'print'}
                    onChange={(e) => savePref('w2_distribution', e.target.value)}
                  >
                    <option value="print">Print</option>
                    <option value="email">Email</option>
                    <option value="both">Both</option>
                  </select>
                </PrefRow>

                {/* Tax Penalty Rate (#28) */}
                <PrefRow label="Tax Penalty Rate" hint="Monthly penalty rate for late filing (default 5%)">
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      className="block-input w-full"
                      value={prefs.tax_penalty_rate || '5'}
                      onChange={(e) => savePref('tax_penalty_rate', e.target.value)}
                      max="100"
                      step="0.1"
                    />
                    <span className="text-xs text-text-muted">%/mo</span>
                  </div>
                </PrefRow>

                {/* Underpayment Penalty Rate (#29) */}
                <PrefRow label="Underpayment Penalty Rate" hint="Annual rate for underpayment of estimated taxes (default 8%)">
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      className="block-input w-full"
                      value={prefs.underpayment_penalty_rate || '8'}
                      onChange={(e) => savePref('underpayment_penalty_rate', e.target.value)}
                      max="100"
                      step="0.1"
                    />
                    <span className="text-xs text-text-muted">%/yr</span>
                  </div>
                </PrefRow>

                {/* FUTA Credit Reduction State (#30) */}
                <PrefRow label="FUTA Credit Reduction State" hint="Enable if your state hasn't repaid its federal unemployment loan">
                  <PrefToggle
                    value={prefs.futa_credit_reduction === 'true'}
                    onChange={(v) => savePref('futa_credit_reduction', String(v))}
                  />
                </PrefRow>

                {/* Supplemental Wage Flat Rate (#31) */}
                <PrefRow label="Supplemental Wage Flat Rate" hint="Flat withholding rate for bonuses and supplemental wages (default 22%)">
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      className="block-input w-full"
                      value={prefs.supplemental_rate || '22'}
                      onChange={(e) => savePref('supplemental_rate', e.target.value)}
                      max="100"
                      step="0.1"
                    />
                    <span className="text-xs text-text-muted">%</span>
                  </div>
                </PrefRow>

                {/* Third-Party Sick Pay (#32) */}
                <PrefRow label="Third-Party Sick Pay" hint="Track third-party sick pay for tax reporting purposes">
                  <PrefToggle
                    value={prefs.third_party_sick_pay === 'true'}
                    onChange={(v) => savePref('third_party_sick_pay', String(v))}
                  />
                </PrefRow>

                {/* Fringe Benefit Tracking (#33) */}
                <PrefRow label="Fringe Benefit Tracking" hint="Track taxable fringe benefits (vehicles, meals, etc.)">
                  <PrefToggle
                    value={prefs.fringe_benefit_tracking === 'true'}
                    onChange={(v) => savePref('fringe_benefit_tracking', String(v))}
                  />
                </PrefRow>

                {/* Section 125 Cafeteria Plan (#34) */}
                <PrefRow label="Section 125 Cafeteria Plan" hint="Enable pre-tax deductions for health insurance, FSA, etc.">
                  <PrefToggle
                    value={prefs.section_125_plan === 'true'}
                    onChange={(v) => savePref('section_125_plan', String(v))}
                  />
                </PrefRow>

                {/* HSA Employer Contribution Limit (#35) */}
                <PrefRow label="HSA Employer Contribution Limit" hint="Annual employer HSA contribution limits (single / family)">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <div className="text-[10px] text-text-muted mb-0.5">Single</div>
                      <input
                        type="number"
                        className="block-input w-full"
                        value={prefs.hsa_limit_single || '4300'}
                        onChange={(e) => savePref('hsa_limit_single', e.target.value)}
                        step="50"
                      />
                    </div>
                    <div className="flex-1">
                      <div className="text-[10px] text-text-muted mb-0.5">Family</div>
                      <input
                        type="number"
                        className="block-input w-full"
                        value={prefs.hsa_limit_family || '8550'}
                        onChange={(e) => savePref('hsa_limit_family', e.target.value)}
                        step="50"
                      />
                    </div>
                  </div>
                </PrefRow>

                {/* Tip Credit (#36) */}
                <PrefRow label="Tip Credit" hint="Enable tip credit for tipped employees (FICA tip credit rate)">
                  <div className="flex items-center gap-2">
                    <PrefToggle
                      value={prefs.tip_credit_enabled === 'true'}
                      onChange={(v) => savePref('tip_credit_enabled', String(v))}
                    />
                    {prefs.tip_credit_enabled === 'true' && (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          className="block-input"
                          style={{ width: '60px' }}
                          value={prefs.tip_credit_rate || '7.65'}
                          onChange={(e) => savePref('tip_credit_rate', e.target.value)}
                          max="100"
                          step="0.01"
                        />
                        <span className="text-[10px] text-text-muted">%</span>
                      </div>
                    )}
                  </div>
                </PrefRow>

                {/* State Reciprocity (#37) */}
                <PrefRow label="State Reciprocity" hint="Enable multi-state tax reciprocity handling (future feature)">
                  <PrefToggle
                    value={prefs.state_reciprocity === 'true'}
                    onChange={(v) => savePref('state_reciprocity', String(v))}
                  />
                </PrefRow>

                {/* Auto-Calculate Employer Taxes (#38) */}
                <PrefRow label="Auto-Calculate Employer Taxes" hint="Automatically compute employer-side FICA, FUTA, and SUI">
                  <PrefToggle
                    value={(prefs.auto_calc_employer_taxes ?? 'true') === 'true'}
                    onChange={(v) => savePref('auto_calc_employer_taxes', String(v))}
                  />
                </PrefRow>

                {/* Tax-Exempt Employee Handling (#39) */}
                <PrefRow label="Tax-Exempt Employee Handling" hint="How to process employees who claim tax exemption">
                  <select
                    className="block-select w-full"
                    value={prefs.tax_exempt_handling || 'skip'}
                    onChange={(e) => savePref('tax_exempt_handling', e.target.value)}
                  >
                    <option value="skip">Skip Withholding</option>
                    <option value="zero_rate">Zero-Rate (Track Only)</option>
                    <option value="manual">Manual Entry</option>
                  </select>
                </PrefRow>

                {/* Quarterly Auto-Close (#40) */}
                <PrefRow label="Quarterly Auto-Close" hint="Automatically mark quarters as closed on their due date">
                  <PrefToggle
                    value={prefs.quarterly_auto_close === 'true'}
                    onChange={(v) => savePref('quarterly_auto_close', String(v))}
                  />
                </PrefRow>

                {/* W-4 Compliance Alert Days (#41) */}
                <PrefRow label="W-4 Compliance Alert Days" hint="Days after hire to require W-4 submission (default 30)">
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      className="block-input w-full"
                      value={prefs.w4_compliance_days || '30'}
                      onChange={(e) => savePref('w4_compliance_days', e.target.value)}
                      min="1"
                      max="365"
                      step="1"
                    />
                    <span className="text-xs text-text-muted">days</span>
                  </div>
                </PrefRow>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default TaxConfiguration;
