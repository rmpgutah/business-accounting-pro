import React, { useEffect, useState, useCallback } from 'react';
import { Hash, AlertCircle, Eye, RefreshCw, Trash2, Search } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

// ─── Types ──────────────────────────────────────────────────────────────────

interface NumberSequence {
  id: string;
  entity_type: string;
  prefix: string;
  suffix: string;
  padding: number;
  current_value: number;
  reset_frequency: string;
  last_reset_at: string | null;
  reserved_json: string;
}

const ENTITY_LABELS: Record<string, string> = {
  invoice: 'Invoices',
  bill: 'Bills',
  quote: 'Quotes',
  expense: 'Expenses',
  debt: 'Debts',
  purchase_order: 'Purchase Orders',
  journal_entry: 'Journal Entries',
  project: 'Projects',
};

// ─── DocumentNumbering ──────────────────────────────────────────────────────

const DocumentNumbering: React.FC = () => {
  const activeCompany = useCompanyStore(s => s.activeCompany);
  const companyId = activeCompany?.id || '';

  const [sequences, setSequences] = useState<NumberSequence[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [gapsResult, setGapsResult] = useState<Record<string, any>>({});
  const [renumberPreview, setRenumberPreview] = useState<Record<string, any>>({});
  const [jeGaps, setJeGaps] = useState<{ gaps?: string[]; error?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyMap, setBusyMap] = useState<Record<string, boolean>>({});

  const setBusy = (key: string, v: boolean) => setBusyMap(m => ({ ...m, [key]: v }));

  // ─── Load sequences ─────────────────────────────────────────────────────
  const loadSequences = useCallback(async () => {
    if (!companyId) return;
    let cancelled = false;
    setLoading(true);
    try {
      const rows = await api.numberingList(companyId);
      if (!cancelled) setSequences(Array.isArray(rows) ? rows : []);
    } finally {
      if (!cancelled) setLoading(false);
    }
    return () => { cancelled = true; };
  }, [companyId]);

  useEffect(() => { loadSequences(); }, [loadSequences]);

  // ─── Load previews (sequential, no Promise.all) ─────────────────────────
  useEffect(() => {
    if (!companyId || sequences.length === 0) return;
    let cancelled = false;
    (async () => {
      const map: Record<string, string> = {};
      for (const s of sequences) {
        if (cancelled) break;
        try {
          const p = await api.numberingPreview(companyId, s.entity_type);
          map[s.entity_type] = p?.number || '';
        } catch {
          map[s.entity_type] = '';
        }
      }
      if (!cancelled) setPreviews(map);
    })();
    return () => { cancelled = true; };
  }, [sequences, companyId]);

  // ─── Gap detection ──────────────────────────────────────────────────────
  const checkGaps = async (entityType: string) => {
    if (!companyId) return;
    setBusy(`gaps-${entityType}`, true);
    try {
      const r = await api.numberingGaps(companyId, entityType);
      setGapsResult(prev => ({ ...prev, [entityType]: r }));
    } catch (e: any) {
      setGapsResult(prev => ({ ...prev, [entityType]: { error: e?.message } }));
    } finally {
      setBusy(`gaps-${entityType}`, false);
    }
  };

  // ─── JE gap detection ───────────────────────────────────────────────────
  const checkJeGaps = async () => {
    if (!companyId) return;
    setBusy('je-gaps', true);
    setJeGaps(null);
    try {
      const r = await api.jeGapDetect(companyId);
      setJeGaps(r);
    } catch (e: any) {
      setJeGaps({ error: e?.message });
    } finally {
      setBusy('je-gaps', false);
    }
  };

  // ─── Preview renumber ───────────────────────────────────────────────────
  const previewRenumber = async (entityType: string) => {
    if (!companyId) return;
    setBusy(`renumber-${entityType}`, true);
    try {
      const r = await api.numberingRenumber(companyId, entityType, true);
      setRenumberPreview(prev => ({ ...prev, [entityType]: r }));
    } catch (e: any) {
      setRenumberPreview(prev => ({ ...prev, [entityType]: { error: e?.message } }));
    } finally {
      setBusy(`renumber-${entityType}`, false);
    }
  };

  // ─── Apply renumber ─────────────────────────────────────────────────────
  const applyRenumber = async (entityType: string) => {
    if (!companyId) return;
    const count = renumberPreview[entityType]?.changes?.length ?? 0;
    if (!window.confirm(`Renumber ${count} ${ENTITY_LABELS[entityType] || entityType} records? This rewrites existing numbers and creates audit entries.`)) return;
    setBusy(`renumber-${entityType}`, true);
    try {
      const r = await api.numberingRenumber(companyId, entityType, false);
      setRenumberPreview(prev => ({ ...prev, [entityType]: r }));
      await loadSequences();
    } catch (e: any) {
      setRenumberPreview(prev => ({ ...prev, [entityType]: { error: e?.message } }));
    } finally {
      setBusy(`renumber-${entityType}`, false);
    }
  };

  // ─── Release held number ────────────────────────────────────────────────
  const [releaseForm, setReleaseForm] = useState<Record<string, string>>({});

  const release = async (entityType: string) => {
    if (!companyId) return;
    const value = releaseForm[entityType]?.trim();
    if (!value) return;
    if (!window.confirm(`Release reserved number "${value}" for ${ENTITY_LABELS[entityType] || entityType}?`)) return;
    setBusy(`release-${entityType}`, true);
    try {
      await api.numberingRelease(companyId, entityType, value);
      setReleaseForm(f => ({ ...f, [entityType]: '' }));
      await loadSequences();
    } finally {
      setBusy(`release-${entityType}`, false);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────

  if (!activeCompany) return (
    <div className="flex items-center justify-center h-40 text-text-muted text-sm">
      Select a company first.
    </div>
  );

  if (loading) return (
    <div className="flex items-center justify-center h-40 text-text-muted text-sm">
      Loading sequences...
    </div>
  );

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <Hash size={16} className="text-accent-primary" />
        <h3 className="text-sm font-semibold text-text-primary">Document Numbering &amp; Gap Detection</h3>
      </div>

      {/* JE Gap Detection banner */}
      <div className="block-card p-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Search size={13} className="text-accent-blue" />
            <span className="text-xs font-semibold text-text-primary">Journal Entry Gap Detection</span>
          </div>
          <button className="block-btn flex items-center gap-1.5 text-xs" onClick={checkJeGaps} disabled={busyMap['je-gaps']}>
            <AlertCircle size={12} />
            {busyMap['je-gaps'] ? 'Scanning...' : 'Scan JE Gaps'}
          </button>
          {jeGaps && (
            <div className={`text-xs flex-1 ${jeGaps.error ? 'text-accent-expense' : jeGaps.gaps?.length === 0 ? 'text-accent-income' : 'text-accent-warning'}`}>
              {jeGaps.error
                ? `Error: ${jeGaps.error}`
                : jeGaps.gaps?.length === 0
                ? 'No gaps detected in journal entries.'
                : `Gaps detected (up to 25 shown): ${(jeGaps.gaps || []).join(', ')}`}
            </div>
          )}
        </div>
      </div>

      {/* Sequences */}
      {sequences.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><Hash size={24} className="text-text-muted" /></div>
          <p className="text-sm text-text-secondary font-medium">No numbering sequences found</p>
          <p className="text-xs text-text-muted mt-1">Sequences are auto-created when records are generated.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sequences.map(seq => {
            const gapData = gapsResult[seq.entity_type];
            const rnData = renumberPreview[seq.entity_type];
            const isBusyGaps = busyMap[`gaps-${seq.entity_type}`];
            const isBusyRn = busyMap[`renumber-${seq.entity_type}`];
            const isBusyRel = busyMap[`release-${seq.entity_type}`];
            const hasRnChanges = rnData?.changes?.length > 0;

            return (
              <div key={seq.id} className="block-card space-y-3">
                {/* Sequence header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Hash size={13} className="text-accent-primary" />
                    <span className="text-sm font-semibold text-text-primary">
                      {ENTITY_LABELS[seq.entity_type] || seq.entity_type}
                    </span>
                    <span className="block-badge block-badge-blue font-mono text-[10px]">
                      {seq.prefix || ''}{String(seq.current_value).padStart(seq.padding, '0')}{seq.suffix || ''}
                    </span>
                  </div>
                  <div className="text-xs text-text-muted">
                    Next: <span className="font-mono text-accent-primary">{previews[seq.entity_type] || '—'}</span>
                  </div>
                </div>

                {/* Sequence details */}
                <div className="grid grid-cols-4 gap-3 text-xs">
                  <div><span className="text-text-muted">Prefix:</span> <span className="font-mono text-text-secondary">{seq.prefix || '—'}</span></div>
                  <div><span className="text-text-muted">Suffix:</span> <span className="font-mono text-text-secondary">{seq.suffix || '—'}</span></div>
                  <div><span className="text-text-muted">Padding:</span> <span className="text-text-secondary">{seq.padding}</span></div>
                  <div><span className="text-text-muted">Reset:</span> <span className="text-text-secondary">{seq.reset_frequency}</span></div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-border-primary">
                  <button
                    className="block-btn text-xs flex items-center gap-1"
                    onClick={() => checkGaps(seq.entity_type)}
                    disabled={isBusyGaps}
                  >
                    <AlertCircle size={11} />{isBusyGaps ? 'Scanning...' : 'Find Gaps'}
                  </button>
                  <button
                    className="block-btn text-xs flex items-center gap-1"
                    onClick={() => previewRenumber(seq.entity_type)}
                    disabled={isBusyRn}
                  >
                    <Eye size={11} />{isBusyRn ? 'Previewing...' : 'Preview Renumber'}
                  </button>
                  {hasRnChanges && (
                    <button
                      className="block-btn text-xs flex items-center gap-1 text-accent-warning"
                      onClick={() => applyRenumber(seq.entity_type)}
                      disabled={isBusyRn}
                    >
                      <RefreshCw size={11} />Apply ({rnData.changes.length})
                    </button>
                  )}
                  {/* Release held number */}
                  <div className="flex items-center gap-1 ml-auto">
                    <input
                      type="text"
                      className="block-input text-xs font-mono w-28"
                      placeholder="Release #"
                      value={releaseForm[seq.entity_type] || ''}
                      onChange={e => setReleaseForm(f => ({ ...f, [seq.entity_type]: e.target.value }))}
                    />
                    <button
                      className="block-btn text-xs flex items-center gap-1"
                      onClick={() => release(seq.entity_type)}
                      disabled={isBusyRel || !releaseForm[seq.entity_type]?.trim()}
                    >
                      <Trash2 size={11} />{isBusyRel ? 'Releasing...' : 'Release'}
                    </button>
                  </div>
                </div>

                {/* Gap results */}
                {gapData && (
                  <div className={`text-xs px-3 py-2 border rounded ${gapData.error ? 'text-accent-expense border-accent-expense/20 bg-accent-expense/5' : gapData.gaps?.length === 0 ? 'text-accent-income border-accent-income/20 bg-accent-income/5' : 'text-accent-warning border-accent-warning/20 bg-accent-warning/5'}`}
                    style={{ borderRadius: 'var(--app-radius)' }}>
                    {gapData.error
                      ? `Error: ${gapData.error}`
                      : gapData.gaps?.length === 0
                      ? `No gaps. ${gapData.total ?? 0} records scanned.`
                      : `Gaps (${gapData.gaps?.length}): ${(gapData.gaps || []).slice(0, 20).join(', ')}${(gapData.gaps?.length || 0) > 20 ? '…' : ''}`}
                  </div>
                )}

                {/* Renumber preview results */}
                {rnData && (
                  <div className={`text-xs px-3 py-2 border ${rnData.error ? 'text-accent-expense border-accent-expense/20 bg-accent-expense/5' : 'text-accent-blue border-accent-blue/20 bg-accent-blue/5'}`}
                    style={{ borderRadius: 'var(--app-radius)' }}>
                    {rnData.error
                      ? `Error: ${rnData.error}`
                      : rnData.changes?.length === 0
                      ? 'No changes needed — numbers are already sequential.'
                      : `Will renumber ${rnData.changes?.length} records. First: ${rnData.changes?.[0]?.from || '(none)'} → ${rnData.changes?.[0]?.to || '(none)'}.`}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DocumentNumbering;
