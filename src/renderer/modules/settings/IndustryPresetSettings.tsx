import React, { useState, useEffect, useMemo, useCallback } from 'react';
import * as Icons from 'lucide-react';
import { Sparkles, RefreshCw, Download, Upload, Plus, Check, AlertCircle } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import {
  INDUSTRY_PRESETS,
  getPreset,
  diffPreset,
  exportPresetJson,
  parsePresetJson,
  type IndustryPreset,
} from '../../lib/industry-presets';
import { COA_TEMPLATES } from '../../lib/coa-templates';
import OnboardingWizard from '../../components/OnboardingWizard';

function getIcon(name: string): React.FC<any> {
  const Comp = (Icons as any)[name];
  return Comp || Icons.Briefcase;
}

const STORAGE_CUSTOM = 'industry_custom_presets_v1';

function loadCustomPresets(): IndustryPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_CUSTOM);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveCustomPresets(list: IndustryPreset[]) {
  try { localStorage.setItem(STORAGE_CUSTOM, JSON.stringify(list)); } catch { /* ignore */ }
}

export const IndustryPresetSettings: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [appliedKey, setAppliedKey] = useState<string>('');
  const [appliedAt, setAppliedAt] = useState<string>('');
  const [customPresets, setCustomPresets] = useState<IndustryPreset[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [diff, setDiff] = useState<ReturnType<typeof diffPreset> | null>(null);
  const [applying, setApplying] = useState(false);
  const [resultMsg, setResultMsg] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [showJsonImport, setShowJsonImport] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [showBuilder, setShowBuilder] = useState(false);
  const [builderJson, setBuilderJson] = useState('');

  const allPresets = useMemo(() => [...INDUSTRY_PRESETS, ...customPresets], [customPresets]);

  useEffect(() => {
    setCustomPresets(loadCustomPresets());
    (async () => {
      try {
        const k = await api.getSetting('industry_preset_key');
        if (k) setAppliedKey(k);
        const a = await api.getSetting('industry_preset_applied_at');
        if (a) setAppliedAt(a);
      } catch { /* ignore */ }
    })();
  }, [activeCompany?.id]);

  // Compute diff when a preset is selected
  useEffect(() => {
    if (!selectedKey || !activeCompany?.id) { setDiff(null); return; }
    const p = allPresets.find((x) => x.key === selectedKey);
    if (!p) { setDiff(null); return; }
    (async () => {
      const existing = await api.industryGetExisting(activeCompany.id);
      if (!existing) return;
      const coa = COA_TEMPLATES.find((t) => t.id === p.coaTemplateKey);
      const accountCodes = (coa?.accounts || []).map((a) => a.code);
      const d = diffPreset(p, {
        categoryNames: new Set(existing.categoryNames.map((s) => s.toLowerCase())),
        vendorNames: new Set(existing.vendorNames.map((s) => s.toLowerCase())),
        fieldKeys: new Set(existing.fields),
        accountCodes: new Set(existing.accountCodes),
      }, accountCodes);
      setDiff(d);
    })();
  }, [selectedKey, activeCompany?.id, allPresets]);

  const handleApply = useCallback(async () => {
    if (!selectedKey || !activeCompany?.id) return;
    const p = allPresets.find((x) => x.key === selectedKey);
    if (!p) return;
    setApplying(true);
    setResultMsg(null);
    try {
      const coa = COA_TEMPLATES.find((t) => t.id === p.coaTemplateKey);
      const result = await api.industryApplyPreset({
        companyId: activeCompany.id,
        presetKey: p.key,
        preset: p,
        accountSeeds: coa?.accounts || [],
      });
      if (result.error) {
        setResultMsg({ type: 'err', msg: result.error });
      } else {
        const s = result.summary;
        setResultMsg({ type: 'ok', msg: `Applied. +${s.accountsAdded} accounts, +${s.categoriesAdded} categories, +${s.vendorsAdded} vendors, +${s.fieldsAdded} fields.` });
        setAppliedKey(p.key);
        setAppliedAt(new Date().toISOString());
      }
    } catch (err: any) {
      setResultMsg({ type: 'err', msg: err?.message || 'Apply failed' });
    } finally {
      setApplying(false);
    }
  }, [selectedKey, activeCompany?.id, allPresets]);

  const handleExport = (preset: IndustryPreset) => {
    const json = exportPresetJson(preset);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `preset-${preset.key}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const result = parsePresetJson(jsonText);
    if (!result.ok) {
      setResultMsg({ type: 'err', msg: result.error });
      return;
    }
    const next = [...customPresets.filter((p) => p.key !== result.preset.key), result.preset];
    setCustomPresets(next);
    saveCustomPresets(next);
    setShowJsonImport(false);
    setJsonText('');
    setResultMsg({ type: 'ok', msg: `Imported preset: ${result.preset.label}` });
  };

  const handleBuilderSave = () => {
    const result = parsePresetJson(builderJson);
    if (!result.ok) {
      setResultMsg({ type: 'err', msg: result.error });
      return;
    }
    const next = [...customPresets.filter((p) => p.key !== result.preset.key), result.preset];
    setCustomPresets(next);
    saveCustomPresets(next);
    setShowBuilder(false);
    setBuilderJson('');
    setResultMsg({ type: 'ok', msg: `Saved custom preset: ${result.preset.label}` });
  };

  const builderTemplate = JSON.stringify({
    key: 'my-industry',
    label: 'My Industry',
    description: 'Custom preset for my business',
    icon: 'Briefcase',
    coaTemplateKey: 'service',
    defaultCategories: [{ name: 'Sample Income', type: 'income', color: '#22c55e', tax_deductible: false }],
    defaultVendors: [{ name: 'Sample Vendor', type: 'service' }],
    invoiceSettings: { accent_color: '#2563eb', default_due_days: 30 },
    defaultDeductions: [],
    industrySpecificFields: [],
    setupHints: [],
  }, null, 2);

  const currentPreset = appliedKey ? allPresets.find((p) => p.key === appliedKey) : null;

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      <div className="module-header">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary" style={{ borderRadius: 6 }}>
            <Sparkles size={18} className="text-accent-blue" />
          </div>
          <div>
            <h2 className="module-title text-text-primary">Industry Presets</h2>
            <p className="text-xs text-text-muted mt-0.5">Apply industry-specific categories, accounts, vendors, and fields. Always additive — never destructive.</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button className="block-btn flex items-center gap-1 text-xs" onClick={() => setShowWizard(true)}>
              <RefreshCw size={13} /> Re-run Wizard
            </button>
            <button className="block-btn flex items-center gap-1 text-xs" onClick={() => { setShowBuilder(true); setBuilderJson(builderTemplate); }}>
              <Plus size={13} /> Custom Preset
            </button>
            <button className="block-btn flex items-center gap-1 text-xs" onClick={() => setShowJsonImport(true)}>
              <Upload size={13} /> Import JSON
            </button>
          </div>
        </div>
      </div>

      {resultMsg && (
        <div
          className="text-xs"
          style={{
            padding: '10px 14px',
            background: resultMsg.type === 'ok' ? 'rgba(34,197,94,0.08)' : 'rgba(248,113,113,0.08)',
            border: `1px solid ${resultMsg.type === 'ok' ? 'rgba(34,197,94,0.25)' : 'rgba(248,113,113,0.25)'}`,
            color: resultMsg.type === 'ok' ? '#22c55e' : '#f87171',
            borderRadius: 6,
          }}
        >
          {resultMsg.msg}
        </div>
      )}

      {/* Currently applied */}
      <div className="block-card">
        <div className="text-xs text-text-muted uppercase tracking-wider mb-2">Current Preset</div>
        {currentPreset ? (
          <div className="flex items-center gap-3">
            <div style={{ width: 36, height: 36, background: 'var(--color-accent-blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6 }}>
              {(() => { const Icon = getIcon(currentPreset.icon); return <Icon size={18} color="white" />; })()}
            </div>
            <div className="flex-1">
              <div className="text-sm font-bold text-text-primary">{currentPreset.label}</div>
              <div className="text-xs text-text-muted">{currentPreset.description}</div>
              {appliedAt && <div className="text-[11px] text-text-muted mt-0.5">Applied {new Date(appliedAt).toLocaleString()}</div>}
            </div>
            <button className="block-btn text-xs" onClick={() => handleExport(currentPreset)}><Download size={12} /> Export</button>
          </div>
        ) : (
          <div className="text-xs text-text-muted">No preset applied yet. Pick one below.</div>
        )}
      </div>

      {/* All presets grid */}
      <div className="block-card">
        <div className="text-xs text-text-muted uppercase tracking-wider mb-3">Available Presets</div>
        <div className="grid grid-cols-3 gap-3">
          {allPresets.map((p) => {
            const Icon = getIcon(p.icon);
            const selected = selectedKey === p.key;
            const isApplied = appliedKey === p.key;
            const isCustom = customPresets.some((c) => c.key === p.key);
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setSelectedKey(p.key)}
                className="block-card text-left transition-all"
                style={{
                  padding: 12,
                  cursor: 'pointer',
                  borderColor: selected ? 'var(--color-accent-blue)' : 'var(--color-border-primary)',
                  background: selected ? 'rgba(37,99,235,0.08)' : 'var(--color-bg-secondary-solid)',
                }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div style={{ width: 28, height: 28, background: selected ? 'var(--color-accent-blue)' : 'var(--color-bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6 }}>
                    <Icon size={14} color={selected ? 'white' : 'var(--color-text-muted)'} />
                  </div>
                  <span className="text-sm font-semibold text-text-primary">{p.label}</span>
                  {isApplied && <Check size={12} className="text-accent-income ml-auto" />}
                  {isCustom && <span className="block-badge block-badge-warning text-[9px] ml-auto">CUSTOM</span>}
                </div>
                <p className="text-[11px] text-text-muted leading-snug">{p.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Diff view */}
      {selectedKey && diff && (
        <div className="block-card">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-text-muted uppercase tracking-wider">Apply Preview</div>
            <button
              className="block-btn-primary flex items-center gap-1 text-xs"
              onClick={handleApply}
              disabled={applying}
            >
              {applying ? 'Applying…' : 'Apply Preset'}
            </button>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <DiffStat label="Accounts" add={diff.accountsAdd} skip={diff.accountsSkip} />
            <DiffStat label="Categories" add={diff.categoriesAdd} skip={diff.categoriesSkip} />
            <DiffStat label="Vendors" add={diff.vendorsAdd} skip={diff.vendorsSkip} />
            <DiffStat label="Custom Fields" add={diff.fieldsAdd} skip={diff.fieldsSkip} />
          </div>
          <p className="text-[11px] text-text-muted mt-3 flex items-center gap-1">
            <AlertCircle size={11} /> Existing items will never be overwritten or removed. Re-applying is safe.
          </p>
        </div>
      )}

      {/* JSON import dialog */}
      {showJsonImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="block-card" style={{ width: 600, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div className="flex items-center justify-between p-4 border-b border-border-primary">
              <div className="text-sm font-bold text-text-primary">Import Preset (JSON)</div>
              <button className="block-btn text-xs" onClick={() => setShowJsonImport(false)}>Close</button>
            </div>
            <div className="p-4 flex-1 overflow-y-auto">
              <textarea
                className="block-input"
                style={{ width: '100%', height: 300, fontFamily: 'monospace', fontSize: 11 }}
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                placeholder="Paste preset JSON…"
              />
            </div>
            <div className="p-4 border-t border-border-primary flex justify-end gap-2">
              <button className="block-btn text-xs" onClick={() => setShowJsonImport(false)}>Cancel</button>
              <button className="block-btn-primary text-xs" onClick={handleImport}>Import</button>
            </div>
          </div>
        </div>
      )}

      {/* Custom builder dialog */}
      {showBuilder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="block-card" style={{ width: 700, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            <div className="flex items-center justify-between p-4 border-b border-border-primary">
              <div>
                <div className="text-sm font-bold text-text-primary">Build Custom Preset</div>
                <div className="text-[11px] text-text-muted">Customize the JSON below. Saved locally to this company.</div>
              </div>
              <button className="block-btn text-xs" onClick={() => setShowBuilder(false)}>Close</button>
            </div>
            <div className="p-4 flex-1 overflow-y-auto">
              <textarea
                className="block-input"
                style={{ width: '100%', height: 380, fontFamily: 'monospace', fontSize: 11 }}
                value={builderJson}
                onChange={(e) => setBuilderJson(e.target.value)}
              />
            </div>
            <div className="p-4 border-t border-border-primary flex justify-end gap-2">
              <button className="block-btn text-xs" onClick={() => setShowBuilder(false)}>Cancel</button>
              <button className="block-btn-primary text-xs" onClick={handleBuilderSave}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Re-run wizard */}
      {showWizard && activeCompany && (
        <OnboardingWizard
          companyId={activeCompany.id}
          initialPresetKey={appliedKey || undefined}
          onClose={() => setShowWizard(false)}
          onComplete={() => setShowWizard(false)}
        />
      )}
    </div>
  );
};

const DiffStat: React.FC<{ label: string; add: number; skip: number }> = ({ label, add, skip }) => (
  <div className="block-card" style={{ padding: 10 }}>
    <div className="text-[11px] text-text-muted uppercase tracking-wider">{label}</div>
    <div className="flex items-baseline gap-3 mt-1">
      <span className="text-lg font-bold text-accent-income">+{add}</span>
      <span className="text-xs text-text-muted">add</span>
      <span className="text-sm text-text-muted">{skip}</span>
      <span className="text-xs text-text-muted">skip</span>
    </div>
  </div>
);

export default IndustryPresetSettings;
