import React, { useEffect, useState, useCallback } from 'react';
import { Hash, Save, Eye, AlertCircle, Wand2 } from 'lucide-react';
import { useCompanyStore } from '../../stores/companyStore';

interface NumberSequence {
  id: string;
  company_id: string;
  entity_type: string;
  prefix: string;
  suffix: string;
  padding: number;
  current_value: number;
  reset_frequency: 'never' | 'yearly' | 'monthly' | 'quarterly';
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

function ipc(channel: string, payload?: any): Promise<any> {
  return (window as any).electronAPI.invoke(channel, payload);
}

const NumberingSettings: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [sequences, setSequences] = useState<NumberSequence[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string>('');
  const [gapsResult, setGapsResult] = useState<Record<string, any>>({});
  const [renumberPreview, setRenumberPreview] = useState<Record<string, any>>({});

  const loadSequences = useCallback(async () => {
    if (!activeCompany) return;
    const rows = await ipc('numbering:list', { companyId: activeCompany.id });
    if (Array.isArray(rows)) setSequences(rows);
  }, [activeCompany]);

  useEffect(() => { loadSequences(); }, [loadSequences]);

  // Refresh previews whenever sequences change
  useEffect(() => {
    if (!activeCompany) return;
    (async () => {
      const map: Record<string, string> = {};
      for (const s of sequences) {
        const p = await ipc('numbering:preview', { companyId: activeCompany.id, entityType: s.entity_type });
        map[s.entity_type] = p?.number || '';
      }
      setPreviews(map);
    })();
  }, [sequences, activeCompany]);

  const updateField = (id: string, field: keyof NumberSequence, value: any) => {
    setSequences(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const saveSequence = async (seq: NumberSequence) => {
    if (!activeCompany) return;
    setSavingId(seq.id);
    try {
      await ipc('numbering:save', {
        id: seq.id,
        data: {
          prefix: seq.prefix,
          suffix: seq.suffix,
          padding: Number(seq.padding) || 5,
          reset_frequency: seq.reset_frequency,
          current_value: Number(seq.current_value) || 0,
        },
      });
      await loadSequences();
    } finally {
      setSavingId('');
    }
  };

  const checkGaps = async (entityType: string) => {
    if (!activeCompany) return;
    const r = await ipc('numbering:gaps', { companyId: activeCompany.id, entityType });
    setGapsResult(prev => ({ ...prev, [entityType]: r }));
  };

  const previewRenumber = async (entityType: string) => {
    if (!activeCompany) return;
    const r = await ipc('numbering:renumber', { companyId: activeCompany.id, entityType, dryRun: true });
    setRenumberPreview(prev => ({ ...prev, [entityType]: r }));
  };

  const applyRenumber = async (entityType: string) => {
    if (!activeCompany) return;
    if (!window.confirm('This will rewrite numbers on existing records. An audit-log entry is created for each change. Continue?')) return;
    const r = await ipc('numbering:renumber', { companyId: activeCompany.id, entityType, dryRun: false });
    setRenumberPreview(prev => ({ ...prev, [entityType]: r }));
    await loadSequences();
  };

  if (!activeCompany) return null;

  return (
    <div className="block-card space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 flex items-center justify-center bg-bg-tertiary border border-border-primary shrink-0" style={{ borderRadius: '6px' }}>
          <Hash size={16} className="text-accent-blue" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Numbering</h3>
          <p className="text-xs text-text-muted mt-0.5">Format and sequence numbers for each record type. Tokens: {`{YYYY} {YY} {MM} {Q} {COMPANY}`}</p>
        </div>
      </div>
      <div className="border-t border-border-primary pt-4 space-y-3">
        {sequences.map(seq => (
          <div key={seq.id} className="p-3 border border-border-primary" style={{ borderRadius: '6px' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-text-primary">{ENTITY_LABELS[seq.entity_type] || seq.entity_type}</div>
              <div className="text-xs text-text-muted">
                Next: <span className="font-mono text-accent-blue">{previews[seq.entity_type] || '—'}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
              <div>
                <label className="block text-text-muted mb-1">Prefix</label>
                <input className="block-input text-xs w-full" value={seq.prefix} onChange={e => updateField(seq.id, 'prefix', e.target.value)} />
              </div>
              <div>
                <label className="block text-text-muted mb-1">Suffix</label>
                <input className="block-input text-xs w-full" value={seq.suffix} onChange={e => updateField(seq.id, 'suffix', e.target.value)} />
              </div>
              <div>
                <label className="block text-text-muted mb-1">Padding</label>
                <input type="number" min={1} max={10} className="block-input text-xs w-full" value={seq.padding} onChange={e => updateField(seq.id, 'padding', parseInt(e.target.value) || 5)} />
              </div>
              <div>
                <label className="block text-text-muted mb-1">Reset</label>
                <select className="block-input text-xs w-full" value={seq.reset_frequency} onChange={e => updateField(seq.id, 'reset_frequency', e.target.value as any)}>
                  <option value="never">Never</option>
                  <option value="yearly">Yearly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <div>
                <label className="block text-text-muted mb-1">Current Value</label>
                <input type="number" min={0} className="block-input text-xs w-full" value={seq.current_value} onChange={e => updateField(seq.id, 'current_value', parseInt(e.target.value) || 0)} />
              </div>
            </div>
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <button className="block-btn-primary text-xs flex items-center gap-1" disabled={savingId === seq.id} onClick={() => saveSequence(seq)}>
                <Save size={12} /> {savingId === seq.id ? 'Saving…' : 'Save'}
              </button>
              <button className="block-btn text-xs flex items-center gap-1" onClick={() => checkGaps(seq.entity_type)}>
                <AlertCircle size={12} /> Find Gaps
              </button>
              <button className="block-btn text-xs flex items-center gap-1" onClick={() => previewRenumber(seq.entity_type)}>
                <Eye size={12} /> Preview Renumber
              </button>
              {renumberPreview[seq.entity_type]?.changes?.length > 0 && (
                <button className="block-btn-danger text-xs flex items-center gap-1" onClick={() => applyRenumber(seq.entity_type)}>
                  <Wand2 size={12} /> Apply ({renumberPreview[seq.entity_type].changes.length})
                </button>
              )}
            </div>
            {gapsResult[seq.entity_type] && (
              <div className="mt-2 text-xs text-text-muted">
                {gapsResult[seq.entity_type].error ? (
                  <span className="text-accent-expense">Error: {gapsResult[seq.entity_type].error}</span>
                ) : gapsResult[seq.entity_type].gaps?.length === 0 ? (
                  <span style={{ color: '#10b981' }}>No gaps. {gapsResult[seq.entity_type].total ?? 0} records.</span>
                ) : (
                  <span>Gaps detected: {(gapsResult[seq.entity_type].gaps || []).slice(0, 20).join(', ')}{gapsResult[seq.entity_type].gaps?.length > 20 ? '…' : ''}</span>
                )}
              </div>
            )}
            {renumberPreview[seq.entity_type]?.changes?.length > 0 && (
              <div className="mt-2 text-xs text-text-muted">
                Will renumber {renumberPreview[seq.entity_type].changes.length} records. First: {renumberPreview[seq.entity_type].changes[0].from || '(empty)'} → {renumberPreview[seq.entity_type].changes[0].to}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default NumberingSettings;
