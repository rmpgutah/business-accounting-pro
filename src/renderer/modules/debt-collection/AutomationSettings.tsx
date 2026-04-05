import React, { useEffect, useState, useCallback } from 'react';
import { X } from 'lucide-react';
import api from '../../lib/api';
import { formatStatus } from '../../lib/format';
import { useCompanyStore } from '../../stores/companyStore';

// ─── Types ──────────────────────────────────────────────
interface AutomationRule {
  id: string;
  company_id: string;
  from_stage: string;
  to_stage: string;
  days_after_entry: number;
  action: string;
  require_review: number;
  enabled: number;
}

interface DebtTemplate {
  id: string;
  company_id: string;
  name: string;
  type: string;
  subject: string;
  body: string;
  severity: string;
  is_default: number;
}

interface AutomationSettingsProps {
  onClose: () => void;
}

// ─── Constants ──────────────────────────────────────────
const ACTION_OPTIONS = [
  { value: 'advance_stage', label: 'Advance Stage' },
  { value: 'send_template', label: 'Send Template' },
  { value: 'create_notification', label: 'Create Notification' },
  { value: 'flag_review', label: 'Flag for Review' },
];

const TYPE_COLORS: Record<string, string> = {
  reminder: 'bg-blue-600/20 text-blue-400 border-blue-600/40',
  warning: 'bg-yellow-600/20 text-yellow-400 border-yellow-600/40',
  final_notice: 'bg-orange-600/20 text-orange-400 border-orange-600/40',
  demand_letter: 'bg-red-600/20 text-red-400 border-red-600/40',
  custom: 'bg-purple-600/20 text-purple-400 border-purple-600/40',
};

const SEVERITY_COLORS: Record<string, string> = {
  friendly: 'bg-green-600/20 text-green-400 border-green-600/40',
  formal: 'bg-blue-600/20 text-blue-400 border-blue-600/40',
  final: 'bg-red-600/20 text-red-400 border-red-600/40',
};

// ─── Component ──────────────────────────────────────────
const AutomationSettings: React.FC<AutomationSettingsProps> = ({ onClose }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const companyId = activeCompany?.id || '';

  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [templates, setTemplates] = useState<DebtTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [escalationResult, setEscalationResult] = useState<string | null>(null);
  const [escalationRunning, setEscalationRunning] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateDraft, setTemplateDraft] = useState<{
    name: string;
    subject: string;
    body: string;
  }>({ name: '', subject: '', body: '' });
  const [savingTemplate, setSavingTemplate] = useState(false);

  // ── Load rules ──
  const loadRules = useCallback(async () => {
    if (!companyId) return;
    try {
      let rows = await api.query('debt_automation_rules', { company_id: companyId });
      if (!Array.isArray(rows)) rows = [];
      if (rows.length === 0) {
        await api.debtSeedDefaultAutomation(companyId);
        rows = await api.query('debt_automation_rules', { company_id: companyId });
        if (!Array.isArray(rows)) rows = [];
      }
      setRules(rows as AutomationRule[]);
    } catch (err) {
      console.error('Failed to load automation rules:', err);
    }
  }, [companyId]);

  // ── Load templates ──
  const loadTemplates = useCallback(async () => {
    if (!companyId) return;
    try {
      let rows = await api.query('debt_templates', { company_id: companyId });
      if (!Array.isArray(rows)) rows = [];
      if (rows.length === 0) {
        await api.debtSeedDefaultTemplates(companyId);
        rows = await api.query('debt_templates', { company_id: companyId });
        if (!Array.isArray(rows)) rows = [];
      }
      setTemplates(rows as DebtTemplate[]);
    } catch (err) {
      console.error('Failed to load templates:', err);
    }
  }, [companyId]);

  // ── Initial load ──
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      setLoading(true);
      await Promise.all([loadRules(), loadTemplates()]);
      if (!cancelled) setLoading(false);
    };
    init();
    return () => {
      cancelled = true;
    };
  }, [loadRules, loadTemplates]);

  // ── Rule field update ──
  const handleRuleChange = useCallback(
    async (ruleId: string, field: string, value: any) => {
      setRules((prev) =>
        prev.map((r) => (r.id === ruleId ? { ...r, [field]: value } : r))
      );
      try {
        await api.update('debt_automation_rules', ruleId, { [field]: value });
      } catch (err) {
        console.error('Failed to update rule:', err);
      }
    },
    []
  );

  // ── Run escalation ──
  const handleRunEscalation = useCallback(async () => {
    if (!companyId || escalationRunning) return;
    setEscalationRunning(true);
    setEscalationResult(null);
    try {
      const result = await api.debtRunEscalation(companyId);
      setEscalationResult(
        `Advanced ${result.advanced} debts, Flagged ${result.flagged} for review`
      );
    } catch (err) {
      console.error('Failed to run escalation:', err);
      setEscalationResult('Escalation failed.');
    } finally {
      setEscalationRunning(false);
    }
  }, [companyId, escalationRunning]);

  // ── Template edit ──
  const startEditTemplate = useCallback((t: DebtTemplate) => {
    setEditingTemplateId(t.id);
    setTemplateDraft({ name: t.name, subject: t.subject, body: t.body });
  }, []);

  const cancelEditTemplate = useCallback(() => {
    setEditingTemplateId(null);
    setTemplateDraft({ name: '', subject: '', body: '' });
  }, []);

  const saveTemplate = useCallback(async () => {
    if (!editingTemplateId || savingTemplate) return;
    setSavingTemplate(true);
    try {
      await api.update('debt_templates', editingTemplateId, {
        name: templateDraft.name,
        subject: templateDraft.subject,
        body: templateDraft.body,
      });
      setTemplates((prev) =>
        prev.map((t) =>
          t.id === editingTemplateId
            ? { ...t, name: templateDraft.name, subject: templateDraft.subject, body: templateDraft.body }
            : t
        )
      );
      setEditingTemplateId(null);
    } catch (err) {
      console.error('Failed to save template:', err);
    } finally {
      setSavingTemplate(false);
    }
  }, [editingTemplateId, templateDraft, savingTemplate]);

  // ── Reset templates to defaults ──
  const resetTemplates = useCallback(async () => {
    if (!companyId) return;
    try {
      await api.rawQuery('DELETE FROM debt_templates WHERE company_id = ?', [companyId]);
      await api.debtSeedDefaultTemplates(companyId);
      await loadTemplates();
      setEditingTemplateId(null);
    } catch (err) {
      console.error('Failed to reset templates:', err);
    }
  }, [companyId, loadTemplates]);

  // ── Reset pipeline rules to defaults ──
  const resetRules = useCallback(async () => {
    if (!companyId) return;
    try {
      await api.rawQuery('DELETE FROM debt_automation_rules WHERE company_id = ?', [companyId]);
      await api.debtSeedDefaultAutomation(companyId);
      await loadRules();
    } catch (err) {
      console.error('Failed to reset pipeline rules:', err);
    }
  }, [companyId, loadRules]);

  // ── Stage label helper ──
  const stageLabel = (stage: string) => {
    const s = formatStatus(stage);
    return s.label !== '\u2014' ? s.label : stage.replace(/_/g, ' ');
  };

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/60 z-40"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="block-card-elevated w-full max-w-[700px] max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
          style={{ borderRadius: '2px' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-5 pb-4 border-b border-border-primary">
            <h3 className="text-base font-bold text-text-primary">
              Escalation Pipeline Settings
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors"
              style={{ borderRadius: '2px' }}
            >
              <X size={16} />
            </button>
          </div>

          {loading ? (
            <div className="text-text-muted text-sm text-center py-8">
              Loading settings...
            </div>
          ) : (
            <div className="space-y-6">
              {/* ─── Section 1: Pipeline Rules Table ─── */}
              <div className="block-card p-4" style={{ borderRadius: '2px' }}>
                <h4 className="text-sm font-semibold text-text-primary mb-3">
                  Pipeline Rules
                </h4>
                <div className="overflow-x-auto">
                  <table className="block-table w-full text-sm">
                    <thead>
                      <tr>
                        <th className="text-left px-2 py-2 text-xs font-semibold text-text-muted uppercase tracking-wider">
                          From Stage
                        </th>
                        <th className="text-center px-1 py-2 text-xs font-semibold text-text-muted">
                        </th>
                        <th className="text-left px-2 py-2 text-xs font-semibold text-text-muted uppercase tracking-wider">
                          To Stage
                        </th>
                        <th className="text-left px-2 py-2 text-xs font-semibold text-text-muted uppercase tracking-wider">
                          Days
                        </th>
                        <th className="text-left px-2 py-2 text-xs font-semibold text-text-muted uppercase tracking-wider">
                          Action
                        </th>
                        <th className="text-center px-2 py-2 text-xs font-semibold text-text-muted uppercase tracking-wider">
                          Review
                        </th>
                        <th className="text-center px-2 py-2 text-xs font-semibold text-text-muted uppercase tracking-wider">
                          Enabled
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rules.map((rule) => (
                        <tr
                          key={rule.id}
                          className="border-t border-border-primary hover:bg-bg-hover"
                        >
                          <td className="px-2 py-2 text-text-secondary capitalize text-xs">
                            {stageLabel(rule.from_stage)}
                          </td>
                          <td className="px-1 py-2 text-text-muted text-center text-xs">
                            &rarr;
                          </td>
                          <td className="px-2 py-2 text-text-secondary capitalize text-xs">
                            {stageLabel(rule.to_stage)}
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="number"
                              min={1}
                              value={rule.days_after_entry}
                              onChange={(e) =>
                                handleRuleChange(
                                  rule.id,
                                  'days_after_entry',
                                  parseInt(e.target.value, 10) || 1
                                )
                              }
                              className="block-input text-sm text-center"
                              style={{ width: '60px', borderRadius: '2px' }}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <select
                              value={rule.action}
                              onChange={(e) =>
                                handleRuleChange(rule.id, 'action', e.target.value)
                              }
                              className="block-select text-xs"
                              style={{ borderRadius: '2px' }}
                            >
                              {ACTION_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={rule.require_review === 1}
                              onChange={(e) =>
                                handleRuleChange(
                                  rule.id,
                                  'require_review',
                                  e.target.checked ? 1 : 0
                                )
                              }
                              className="accent-blue-500"
                            />
                          </td>
                          <td className="px-2 py-2 text-center">
                            <label className="relative inline-flex items-center cursor-pointer">
                              <input
                                type="checkbox"
                                checked={rule.enabled === 1}
                                onChange={(e) =>
                                  handleRuleChange(
                                    rule.id,
                                    'enabled',
                                    e.target.checked ? 1 : 0
                                  )
                                }
                                className="sr-only peer"
                              />
                              <div
                                className="w-8 h-4 bg-bg-tertiary rounded-none peer-checked:bg-accent-blue transition-colors relative"
                                style={{ borderRadius: '2px' }}
                              >
                                <div
                                  className="absolute top-0.5 left-0.5 w-3 h-3 bg-text-muted peer-checked:bg-white transition-transform"
                                  style={{
                                    borderRadius: '1px',
                                    transform: rule.enabled === 1 ? 'translateX(16px)' : 'translateX(0)',
                                    backgroundColor: rule.enabled === 1 ? '#fff' : undefined,
                                  }}
                                />
                              </div>
                            </label>
                          </td>
                        </tr>
                      ))}
                      {rules.length === 0 && (
                        <tr>
                          <td
                            colSpan={7}
                            className="text-text-muted text-xs text-center py-4"
                          >
                            No automation rules configured.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ─── Section 2: Run Escalation ─── */}
              <div className="block-card p-4" style={{ borderRadius: '2px' }}>
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-text-primary">
                      Run Escalation Now
                    </h4>
                    <p className="text-xs text-text-muted mt-1">
                      Manually trigger the escalation pipeline for all eligible debts.
                    </p>
                  </div>
                  <button
                    onClick={handleRunEscalation}
                    disabled={escalationRunning}
                    className="block-btn block-btn-primary px-4 py-2 text-sm"
                    style={{ borderRadius: '2px' }}
                  >
                    {escalationRunning ? 'Running...' : 'Run Escalation'}
                  </button>
                </div>
                {escalationResult && (
                  <div
                    className="mt-3 px-3 py-2 text-xs text-text-secondary bg-bg-tertiary border border-border-primary"
                    style={{ borderRadius: '2px' }}
                  >
                    {escalationResult}
                  </div>
                )}
              </div>

              {/* ─── Section 3: Template Management ─── */}
              <div className="block-card p-4" style={{ borderRadius: '2px' }}>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-text-primary">
                    Templates
                  </h4>
                  <button
                    onClick={resetTemplates}
                    className="block-btn text-xs px-2 py-1"
                    style={{ borderRadius: '2px' }}
                  >
                    Reset to Defaults
                  </button>
                </div>

                <div className="space-y-2">
                  {templates.map((t) => (
                    <div key={t.id}>
                      <div
                        className="flex items-center justify-between px-3 py-2 bg-bg-tertiary hover:bg-bg-hover"
                        style={{ borderRadius: '2px' }}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm text-text-primary truncate">
                            {t.name}
                          </span>
                          <span
                            className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase border ${TYPE_COLORS[t.type] || 'block-badge'}`}
                            style={{ borderRadius: '2px' }}
                          >
                            {t.type.replace(/_/g, ' ')}
                          </span>
                          <span
                            className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase border ${SEVERITY_COLORS[t.severity] || 'block-badge'}`}
                            style={{ borderRadius: '2px' }}
                          >
                            {t.severity}
                          </span>
                        </div>
                        <button
                          onClick={() =>
                            editingTemplateId === t.id
                              ? cancelEditTemplate()
                              : startEditTemplate(t)
                          }
                          className="block-btn text-xs px-2 py-1 flex-shrink-0"
                          style={{ borderRadius: '2px' }}
                        >
                          {editingTemplateId === t.id ? 'Cancel' : 'Edit'}
                        </button>
                      </div>

                      {/* Inline editor */}
                      {editingTemplateId === t.id && (
                        <div
                          className="mt-1 p-3 bg-bg-secondary border border-border-primary space-y-3"
                          style={{ borderRadius: '2px' }}
                        >
                          <div>
                            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
                              Name
                            </label>
                            <input
                              type="text"
                              value={templateDraft.name}
                              onChange={(e) =>
                                setTemplateDraft((prev) => ({ ...prev, name: e.target.value }))
                              }
                              className="block-input text-sm"
                              style={{ borderRadius: '2px' }}
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
                              Subject
                            </label>
                            <input
                              type="text"
                              value={templateDraft.subject}
                              onChange={(e) =>
                                setTemplateDraft((prev) => ({ ...prev, subject: e.target.value }))
                              }
                              className="block-input text-sm"
                              style={{ borderRadius: '2px' }}
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
                              Body
                            </label>
                            <textarea
                              rows={8}
                              value={templateDraft.body}
                              onChange={(e) =>
                                setTemplateDraft((prev) => ({ ...prev, body: e.target.value }))
                              }
                              className="block-input font-mono text-sm"
                              style={{ borderRadius: '2px', resize: 'vertical' }}
                            />
                          </div>
                          <div className="flex justify-end">
                            <button
                              onClick={saveTemplate}
                              disabled={savingTemplate}
                              className="block-btn block-btn-primary text-xs px-3 py-1"
                              style={{ borderRadius: '2px' }}
                            >
                              {savingTemplate ? 'Saving...' : 'Save'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  {templates.length === 0 && (
                    <p className="text-text-muted text-xs text-center py-4">
                      No templates found.
                    </p>
                  )}
                </div>
              </div>

              {/* ─── Footer ─── */}
              <div className="flex justify-between pt-4 border-t border-border-primary">
                <button
                  onClick={resetRules}
                  className="block-btn text-xs px-3 py-1.5"
                  style={{ borderRadius: '2px' }}
                >
                  Reset Pipeline to Defaults
                </button>
                <button
                  onClick={onClose}
                  className="block-btn px-4 py-1.5 text-sm"
                  style={{ borderRadius: '2px' }}
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default AutomationSettings;
