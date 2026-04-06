import React, { useEffect, useState, useCallback } from 'react';
import { FileText, Check, Minus, Loader2, AlertTriangle } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/format';

// ─── Types ──────────────────────────────────────────────
interface BundleExportProps {
  debtId: string;
}

interface Debt {
  id: string;
  debtor_name: string;
  balance_due: number;
  status: string;
}

interface BundleCounts {
  payments: number;
  communications: number;
  evidence: number;
  legalActions: number;
  pipelineStages: number;
}

interface SectionItem {
  label: string;
  count: number | null; // null = always included (no count)
  alwaysIncluded: boolean;
}

// ─── Component ──────────────────────────────────────────
const BundleExport: React.FC<BundleExportProps> = ({ debtId }) => {
  const [debt, setDebt] = useState<Debt | null>(null);
  const [counts, setCounts] = useState<BundleCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [resultMsg, setResultMsg] = useState('');
  const [resultType, setResultType] = useState<'success' | 'cancel' | 'error'>('success');

  // ── Load debt + section counts ──
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setResultMsg('');
      try {
        const [debtData, payments, comms, evidence, legal, stages] = await Promise.all([
          api.get('debts', debtId),
          api.query('debt_payments', { debt_id: debtId }),
          api.query('debt_communications', { debt_id: debtId }),
          api.query('debt_evidence', { debt_id: debtId }),
          api.query('debt_legal_actions', { debt_id: debtId }),
          api.query('debt_pipeline_stages', { debt_id: debtId }),
        ]);
        if (cancelled) return;
        setDebt(debtData || null);
        setCounts({
          payments: Array.isArray(payments) ? payments.length : 0,
          communications: Array.isArray(comms) ? comms.length : 0,
          evidence: Array.isArray(evidence) ? evidence.length : 0,
          legalActions: Array.isArray(legal) ? legal.length : 0,
          pipelineStages: Array.isArray(stages) ? stages.length : 0,
        });
      } catch (err) {
        console.error('Failed to load bundle preview data:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [debtId]);

  // ── Build section list ──
  const sections: SectionItem[] = counts
    ? [
        { label: 'Debt Summary Sheet', count: null, alwaysIncluded: true },
        { label: 'Payment History', count: counts.payments, alwaysIncluded: false },
        { label: 'Communication Log', count: counts.communications, alwaysIncluded: false },
        { label: 'Evidence Timeline', count: counts.evidence, alwaysIncluded: false },
        { label: 'Interest Calculation Breakdown', count: null, alwaysIncluded: true },
        { label: 'Legal Actions', count: counts.legalActions, alwaysIncluded: false },
        { label: 'Pipeline History', count: counts.pipelineStages, alwaysIncluded: true },
      ]
    : [];

  // ── Export handler ──
  const handleExport = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    setResultMsg('');
    try {
      const result = await api.debtExportBundle(debtId);
      if (result?.cancelled) {
        setResultMsg('Export cancelled');
        setResultType('cancel');
      } else if (result?.path) {
        setResultMsg(`Bundle saved to: ${result.path}`);
        setResultType('success');
      }
    } catch (err: any) {
      setResultMsg(err?.message || 'Failed to generate bundle');
      setResultType('error');
    } finally {
      setExporting(false);
    }
  }, [debtId, exporting]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-text-muted text-sm">
        Loading bundle preview...
      </div>
    );
  }

  if (!debt) {
    return (
      <div className="block-card text-center py-12">
        <AlertTriangle size={32} className="mx-auto text-amber-400 mb-3" />
        <p className="text-text-muted text-sm">
          Could not load debt data.
        </p>
      </div>
    );
  }

  return (
    <div className="block-card space-y-5">
      {/* Header */}
      <div>
        <h4 className="text-sm font-bold text-text-primary uppercase tracking-wider mb-1">
          Document Bundle Export
        </h4>
        <p className="text-xs text-text-muted">
          Generate a court-ready PDF containing all records for this debt.
        </p>
      </div>

      {/* Debtor Info */}
      <div
        className="bg-bg-tertiary px-4 py-3"
        style={{ borderRadius: '6px' }}
      >
        <div className="grid grid-cols-3 gap-4 text-xs">
          <div>
            <span className="text-text-muted uppercase tracking-wider font-semibold block mb-0.5">
              Debtor
            </span>
            <span className="text-text-primary font-bold">
              {debt.debtor_name}
            </span>
          </div>
          <div>
            <span className="text-text-muted uppercase tracking-wider font-semibold block mb-0.5">
              Balance Due
            </span>
            <span className="text-text-primary font-bold font-mono">
              {formatCurrency(debt.balance_due)}
            </span>
          </div>
          <div>
            <span className="text-text-muted uppercase tracking-wider font-semibold block mb-0.5">
              Status
            </span>
            <span className="text-text-primary font-bold capitalize">
              {(debt.status || '').replace(/_/g, ' ')}
            </span>
          </div>
        </div>
      </div>

      {/* Section Checklist */}
      <div>
        <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
          Bundle Contents
        </label>
        <div className="space-y-1">
          {sections.map((section, idx) => {
            const hasRecords = section.alwaysIncluded || (section.count !== null && section.count > 0);
            return (
              <div
                key={idx}
                className="flex items-center gap-2.5 px-3 py-2 text-xs"
                style={{ borderRadius: '6px' }}
              >
                {hasRecords ? (
                  <Check size={14} className="text-emerald-400 flex-shrink-0" />
                ) : (
                  <Minus size={14} className="text-text-muted flex-shrink-0" />
                )}
                <span className={hasRecords ? 'text-text-secondary' : 'text-text-muted'}>
                  {section.label}
                </span>
                {section.count !== null && (
                  <span className="text-text-muted ml-auto font-mono">
                    {section.count} {section.count === 1 ? 'record' : 'records'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Export Action */}
      <div className="pt-2 border-t border-border-primary">
        <button
          className="block-btn-primary flex items-center gap-2"
          onClick={handleExport}
          disabled={exporting}
        >
          {exporting ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Generating court bundle...
            </>
          ) : (
            <>
              <FileText size={14} />
              Generate Court Bundle
            </>
          )}
        </button>
      </div>

      {/* Result Banner */}
      {resultMsg && (
        <div
          className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold ${
            resultType === 'success'
              ? 'bg-emerald-500/10 text-emerald-400'
              : resultType === 'error'
                ? 'bg-red-500/10 text-red-400'
                : 'bg-bg-tertiary text-text-muted'
          }`}
          style={{ borderRadius: '6px' }}
        >
          {resultType === 'success' && <Check size={14} />}
          {resultType === 'error' && <AlertTriangle size={14} />}
          {resultMsg}
        </div>
      )}
    </div>
  );
};

export default BundleExport;
