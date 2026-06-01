// src/renderer/modules/reports/TaxDeductionFinder.tsx
//
// B13 — Tax Deduction Finder UI.
//
// Shows scanned suggestions ranked by potential dollar value with
// rationale + supporting transaction count. NOT tax advice — each
// suggestion has a "verify with your CPA" caveat in the footer.

import React, { useEffect, useState, useCallback } from 'react';
import { Sparkles, ChevronLeft, FileSearch, AlertCircle, Info } from 'lucide-react';
import api from '../../lib/api';

interface Suggestion {
  category: string;
  type: 'overlooked' | 'miscategorized' | 'underclaimed' | 'documentation';
  title: string;
  detail: string;
  estimated_value: number;
  supporting_count: number;
  supporting_total: number;
  confidence: 'high' | 'medium' | 'low';
  irs_reference?: string;
}

interface ScanResult {
  year: number;
  total_expenses_scanned: number;
  total_potential: number;
  suggestions: Suggestion[];
  generated_at: string;
}

const fmt$ = (n: number): string => '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Props { onBack?: () => void }

const TYPE_ICON: Record<string, React.ReactNode> = {
  overlooked: <Sparkles size={14} style={{ color: 'var(--color-accent-income)' }} />,
  miscategorized: <AlertCircle size={14} style={{ color: 'var(--color-accent-warning)' }} />,
  underclaimed: <FileSearch size={14} style={{ color: 'var(--color-accent-blue)' }} />,
  documentation: <Info size={14} style={{ color: '#64748b' }} />,
};

const TYPE_LABEL: Record<string, string> = {
  overlooked: 'Overlooked',
  miscategorized: 'Miscategorized',
  underclaimed: 'Under-claimed',
  documentation: 'Needs documentation',
};

const TaxDeductionFinder: React.FC<Props> = ({ onBack }) => {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [data, setData] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);

  const scan = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.taxDeductionScan(year);
      if (r && !r.error) setData(r);
    } finally { setLoading(false); }
  }, [year]);

  useEffect(() => { scan(); }, [scan]);

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        {onBack && (
          <button onClick={onBack} className="block-btn flex items-center gap-1.5 text-xs">
            <ChevronLeft size={12} /> Back
          </button>
        )}
        <h2 style={{ fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Sparkles size={22} /> Tax Deduction Finder
        </h2>
        <select
          className="block-input"
          value={year}
          onChange={(e) => setYear(parseInt(e.target.value))}
          style={{ width: 100, marginLeft: 'auto' }}
        >
          {[currentYear - 2, currentYear - 1, currentYear].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {loading && <div style={{ padding: 24, color: 'var(--color-text-muted)' }}>Scanning expenses…</div>}

      {data && !loading && (
        <>
          {/* Header stats */}
          <div className="block-card" style={{ padding: 16, marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              <Stat label="Year Scanned" value={String(data.year)} />
              <Stat label="Expenses Reviewed" value={fmt$(data.total_expenses_scanned)} />
              <Stat label="Potential Deductions" value={fmt$(data.total_potential)} highlight color="var(--color-accent-income)" />
            </div>
          </div>

          {/* Suggestion list */}
          {data.suggestions.length === 0 ? (
            <div className="block-card" style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)' }}>
              <Sparkles size={32} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
              <div style={{ fontSize: 13, fontWeight: 600 }}>No deduction suggestions for {data.year}</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>
                Either you're already claiming everything, or there isn't enough expense data to detect patterns yet.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {data.suggestions.map((s, i) => (
                <div key={i} className="block-card" style={{
                  padding: 16,
                  borderLeft: '3px solid ' + (s.confidence === 'high' ? 'var(--color-accent-income)' : s.confidence === 'medium' ? 'var(--color-accent-warning)' : '#94a3b8'),
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        {TYPE_ICON[s.type]}
                        <span style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)' }}>
                          {TYPE_LABEL[s.type]} · {s.category}
                        </span>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)' }}>{s.title}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', marginBottom: 2 }}>
                        Potential
                      </div>
                      <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-accent-income)' }}>
                        {fmt$(s.estimated_value)}
                      </div>
                    </div>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5, marginBottom: 8 }}>
                    {s.detail}
                  </p>
                  <div style={{ fontSize: 10, color: 'var(--color-text-muted)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    <span>Based on {s.supporting_count} transactions ({fmt$(s.supporting_total)})</span>
                    <span>Confidence: <strong style={{ color: s.confidence === 'high' ? 'var(--color-accent-income)' : s.confidence === 'medium' ? 'var(--color-accent-warning)' : '#94a3b8' }}>{s.confidence}</strong></span>
                    {s.irs_reference && <span>Reference: <code>{s.irs_reference}</code></span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Disclaimer */}
          <div style={{
            marginTop: 16,
            padding: 12,
            border: '1px dashed var(--color-border-primary)',
            borderRadius: 6,
            background: 'rgba(217, 119, 6, 0.05)',
            fontSize: 11,
            color: 'var(--color-text-muted)',
          }}>
            <strong>Not tax advice.</strong> These suggestions are heuristic — based on transaction patterns and not your specific tax situation. Verify each with your CPA or tax preparer before claiming. The "potential" amounts are best-estimate and may differ from what's actually deductible.
          </div>
        </>
      )}
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

export default TaxDeductionFinder;
