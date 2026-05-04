import React, { useState, useEffect } from 'react';
import { Zap, ToggleLeft, ToggleRight, Clock, Plus, Trash2, Edit2, Save, GitBranch, History } from 'lucide-react';
import api from '../../lib/api';
import { formatDate } from '../../lib/format';
import ErrorBanner from '../../components/ErrorBanner';
import WorkflowList from './WorkflowList';
import WorkflowBuilder from './WorkflowBuilder';
import WorkflowExecutionLog from './WorkflowExecutionLog';

type AutomationTab = 'rules' | 'workflows' | 'execution-log';

// ─── Types ───────────────────────────────────────────────
interface AutomationRule {
  id: string;
  name: string;
  trigger_type: string;
  trigger_config: string;
  conditions: string;
  actions: string;
  is_active: number;
  last_run_at: string | null;
  created_at: string;
}

interface RunLogEntry {
  id: string;
  rule_id: string;
  ran_at: string;
  status: string;
  detail: string;
}

// ─── Constants ───────────────────────────────────────────
const TRIGGER_TYPES = [
  { value: 'bill_due_soon',     label: 'Bill Due Soon' },
  { value: 'expense_created',   label: 'Expense Created' },
  { value: 'invoice_overdue',   label: 'Invoice Overdue' },
  { value: 'low_cash_balance',  label: 'Low Cash Balance' },
  { value: 'payment_received',  label: 'Payment Received' },
  { value: 'schedule',          label: 'Scheduled (Daily/Weekly)' },
];

const ACTION_TYPES = [
  { value: 'apply_late_fee',     label: 'Apply Late Fee' },
  { value: 'change_status',      label: 'Change Status' },
  { value: 'create_notification',label: 'Create Notification' },
  { value: 'flag_for_review',    label: 'Flag for Review' },
  { value: 'send_email',         label: 'Send Email' },
];

const TRIGGER_BADGE: Record<string, { border: string; text: string }> = {
  invoice_overdue:  { border: 'border-orange-500',  text: 'text-orange-500' },
  bill_due_soon:    { border: 'border-yellow-400',   text: 'text-yellow-500' },
  payment_received: { border: 'border-green-500',    text: 'text-green-500' },
  expense_created:  { border: 'border-blue-400',     text: 'text-blue-500' },
  low_cash_balance: { border: 'border-red-500',      text: 'text-red-500' },
  schedule:         { border: 'border-purple-500',   text: 'text-purple-500' },
};

function TriggerBadge({ type }: { type: string }) {
  const style = TRIGGER_BADGE[type] ?? { border: 'border-border-secondary', text: 'text-text-secondary' };
  return (
    <span className={`inline-block border ${style.border} ${style.text} text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5`}>
      {type.replace(/_/g, ' ')}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PASS: 'text-accent-income border-accent-income',
    FAIL: 'text-accent-expense border-accent-expense',
    SKIP: 'text-text-muted border-border-secondary',
  };
  return (
    <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 border ${map[status] ?? 'text-text-muted border-border-secondary'}`}>
      {status}
    </span>
  );
}

// ─── Blank rule form ─────────────────────────────────────
const blankRule = () => ({
  name: '',
  trigger_type: 'invoice_overdue',
  days_threshold: '7',
  action_type: 'send_email',
  action_email: '',
  action_message: '',
});

// ─── Builder Form ─────────────────────────────────────────
function RuleBuilder({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: ReturnType<typeof blankRule>;
  onSave: (data: ReturnType<typeof blankRule>) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState(initial ?? blankRule());
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div className="block-card p-5 space-y-4" style={{ borderRadius: '6px' }}>
      <h3 className="text-sm font-bold text-text-primary">
        {initial ? 'Edit Automation' : 'New Automation Rule'}
      </h3>

      {/* Name */}
      <div>
        <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Rule Name *</label>
        <input
          className="block-input w-full"
          placeholder="e.g. Send reminder for overdue invoices"
          value={form.name}
          onChange={e => set('name', e.target.value)}
        />
      </div>

      {/* Trigger */}
      <div>
        <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Trigger</label>
        <select
          className="block-select w-full"
          value={form.trigger_type}
          onChange={e => set('trigger_type', e.target.value)}
        >
          {TRIGGER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      {/* Threshold (for time-based triggers) */}
      {['invoice_overdue', 'bill_due_soon', 'low_cash_balance'].includes(form.trigger_type) && (
        <div>
          <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
            {form.trigger_type === 'low_cash_balance' ? 'Cash Threshold ($)' : 'Days Threshold'}
          </label>
          <input
            className="block-input w-32 font-mono"
            type="number"
            value={form.days_threshold}
            onChange={e => set('days_threshold', e.target.value)}
            placeholder={form.trigger_type === 'low_cash_balance' ? '1000' : '7'}
          />
          <p className="text-[10px] text-text-muted mt-1">
            {form.trigger_type === 'low_cash_balance'
              ? 'Trigger when cash balance falls below this amount'
              : `Trigger when ${form.trigger_type === 'invoice_overdue' ? 'invoice is overdue by' : 'bill is due within'} this many days`
            }
          </p>
        </div>
      )}

      {/* Action */}
      <div>
        <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Action</label>
        <select
          className="block-select w-full"
          value={form.action_type}
          onChange={e => set('action_type', e.target.value)}
        >
          {ACTION_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
      </div>

      {/* Action params */}
      {form.action_type === 'send_email' && (
        <div>
          <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Email Recipient</label>
          <input
            className="block-input w-full"
            type="email"
            placeholder="client@example.com or leave blank for auto"
            value={form.action_email}
            onChange={e => set('action_email', e.target.value)}
          />
        </div>
      )}

      {['send_email', 'create_notification', 'flag_for_review'].includes(form.action_type) && (
        <div>
          <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Message / Note</label>
          <textarea
            className="block-input w-full"
            rows={2}
            placeholder="Message content (supports {{invoice_number}}, {{client_name}}, {{amount}})..."
            value={form.action_message}
            onChange={e => set('action_message', e.target.value)}
            style={{ resize: 'vertical' }}
          />
        </div>
      )}

      {/* Footer */}
      <div className="flex gap-2 justify-end pt-2">
        <button className="block-btn text-xs px-4 py-2" onClick={onCancel}>Cancel</button>
        <button
          className="block-btn-primary inline-flex items-center gap-1.5 text-xs px-4 py-2 font-semibold"
          onClick={() => onSave(form)}
          disabled={saving || !form.name.trim()}
        >
          <Save size={12} />
          {saving ? 'Saving...' : 'Save Rule'}
        </button>
      </div>
    </div>
  );
}

// ─── Rules Tab (existing rule-based automations) ─────────
const RulesTab: React.FC = () => {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [selected, setSelected] = useState<AutomationRule | null>(null);
  const [runLog, setRunLog] = useState<RunLogEntry[]>([]);
  const [loadingLog, setLoadingLog] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadRules = async () => {
    setError('');
    try {
      const data = await api.listAutomations();
      setRules(data ?? []);
    } catch (err: any) {
      console.error('Failed to load automations:', err);
      setError(err?.message || 'Failed to load automations');
    }
  };

  useEffect(() => { loadRules(); }, []);

  const handleSelect = async (rule: AutomationRule) => {
    setSelected(rule);
    setShowBuilder(false);
    setEditingRule(null);
    setRunLog([]);
    setLoadingLog(true);
    try {
      const log = await api.automationRunLog(rule.id);
      setRunLog(log ?? []);
    } catch { /* ignore */ } finally {
      setLoadingLog(false);
    }
  };

  const handleToggle = async (rule: AutomationRule, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.toggleAutomation(rule.id);
      await loadRules();
      if (selected?.id === rule.id) {
        setSelected(prev => prev ? { ...prev, is_active: prev.is_active === 1 ? 0 : 1 } : null);
      }
    } catch { /* ignore */ }
  };

  const handleSave = async (form: ReturnType<typeof blankRule>) => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const triggerConfig = JSON.stringify({
        days: parseInt(form.days_threshold) || 7,
        threshold: parseInt(form.days_threshold) || 7,
      });
      const actions = JSON.stringify([{
        type: form.action_type,
        email: form.action_email,
        message: form.action_message,
      }]);

      if (editingRule) {
        await api.updateAutomation({
          id: editingRule.id,
          name: form.name,
          trigger_type: form.trigger_type,
          trigger_config: triggerConfig,
          conditions: '[]',
          actions,
        });
      } else {
        await api.createAutomation({
          name: form.name,
          trigger_type: form.trigger_type,
          trigger_config: triggerConfig,
          conditions: '[]',
          actions,
        });
      }
      await loadRules();
      setShowBuilder(false);
      setEditingRule(null);
    } catch (err: any) {
      // VISIBILITY: surface save-automation errors instead of swallowing
      console.error('Failed to save automation:', err);
      setError(`Failed to save automation: ${err?.message ?? String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (rule: AutomationRule, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete "${rule.name}"?`)) return;
    setDeleting(rule.id);
    try {
      await api.deleteAutomation(rule.id);
      if (selected?.id === rule.id) setSelected(null);
      await loadRules();
    } catch (err: any) {
      // VISIBILITY: surface delete-automation errors instead of swallowing
      console.error('Failed to delete automation:', err);
      setError(`Failed to delete "${rule.name}": ${err?.message ?? String(err)}`);
    } finally {
      setDeleting(null);
    }
  };

  const handleEdit = (rule: AutomationRule) => {
    setEditingRule(rule);
    setShowBuilder(true);
  };

  // Build initial form from existing rule for editing
  const editInitial = editingRule ? (() => {
    let config: any = {};
    try { config = JSON.parse(editingRule.trigger_config); } catch { }
    let actions: any[] = [];
    try { actions = JSON.parse(editingRule.actions); } catch { }
    const firstAction = actions[0] ?? {};
    return {
      name: editingRule.name,
      trigger_type: editingRule.trigger_type,
      days_threshold: String(config.days ?? config.threshold ?? 7),
      action_type: firstAction.type ?? 'send_email',
      action_email: firstAction.email ?? '',
      action_message: firstAction.message ?? '',
    };
  })() : undefined;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {error && <div className="px-4 pt-4"><ErrorBanner message={error} title="Automations error" onDismiss={() => setError('')} /></div>}
    <div className="flex flex-1 overflow-hidden">
      {/* ── Left Panel ── */}
      <div className="w-72 border-r-2 border-border-primary flex flex-col bg-bg-secondary shrink-0">
        <div className="border-b-2 border-border-primary p-4">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Zap size={16} className="text-text-primary" strokeWidth={2.5} />
              <h1 className="text-sm font-black uppercase tracking-wider text-text-primary">Automations</h1>
            </div>
            <button
              className="block-btn-primary inline-flex items-center gap-1 text-xs px-2.5 py-1.5 font-semibold"
              onClick={() => { setEditingRule(null); setShowBuilder(true); setSelected(null); }}
            >
              <Plus size={11} /> New
            </button>
          </div>
          <p className="text-[10px] text-text-muted">Rules that run automatically on your data</p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {rules.length === 0 ? (
            <div className="p-6 text-center">
              <Zap size={24} className="text-text-muted mx-auto mb-2" />
              <p className="text-xs text-text-muted">No automation rules yet.</p>
              <button
                className="block-btn-primary inline-flex items-center gap-1 text-xs px-3 py-1.5 mt-3 font-semibold"
                onClick={() => { setEditingRule(null); setShowBuilder(true); }}
              >
                <Plus size={11} /> Create First Rule
              </button>
            </div>
          ) : (
            rules.map((rule) => {
              const isSelected = selected?.id === rule.id && !showBuilder;
              return (
                <div
                  key={rule.id}
                  onClick={() => handleSelect(rule)}
                  className={`border-b border-border-primary p-3 cursor-pointer transition-colors ${
                    isSelected ? 'bg-bg-hover' : 'hover:bg-bg-hover/50 transition-colors'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1 mb-1">
                    <p className="text-xs font-semibold text-text-primary leading-tight truncate flex-1">{rule.name}</p>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        className="text-text-muted hover:text-accent-blue p-0.5 transition-colors"
                        onClick={e => { e.stopPropagation(); handleEdit(rule); }}
                        title="Edit"
                      >
                        <Edit2 size={11} />
                      </button>
                      <button
                        className="text-text-muted hover:text-accent-expense p-0.5 transition-colors"
                        onClick={e => handleDelete(rule, e)}
                        disabled={deleting === rule.id}
                        title="Delete"
                      >
                        <Trash2 size={11} />
                      </button>
                      <button onClick={e => handleToggle(rule, e)} title={rule.is_active ? 'Deactivate' : 'Activate'}>
                        {rule.is_active
                          ? <ToggleRight size={18} className="text-accent-income" />
                          : <ToggleLeft size={18} className="text-text-muted" />}
                      </button>
                    </div>
                  </div>
                  <TriggerBadge type={rule.trigger_type} />
                  <div className="flex items-center gap-1 mt-1.5">
                    <Clock size={9} className="text-text-muted" />
                    <span className="text-[10px] text-text-muted">
                      {rule.last_run_at ? formatDate(rule.last_run_at) : 'Never run'}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Right Panel ── */}
      <div className="flex-1 overflow-y-auto bg-bg-primary p-6">
        {showBuilder ? (
          <RuleBuilder
            initial={editInitial}
            onSave={handleSave}
            onCancel={() => { setShowBuilder(false); setEditingRule(null); }}
            saving={saving}
          />
        ) : !selected ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center p-10">
              <Zap size={36} className="text-text-muted mx-auto mb-3" strokeWidth={1.5} />
              <p className="text-sm font-semibold text-text-muted mb-4">Select a rule or create a new one</p>
              <button
                className="block-btn-primary inline-flex items-center gap-1.5 text-xs px-4 py-2 font-semibold"
                onClick={() => { setEditingRule(null); setShowBuilder(true); }}
              >
                <Plus size={12} /> New Automation Rule
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-5 max-w-2xl">
            {/* Rule header */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-text-primary">{selected.name}</h2>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <TriggerBadge type={selected.trigger_type} />
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 border ${
                    selected.is_active ? 'border-accent-income text-accent-income' : 'border-border-secondary text-text-muted'
                  }`}>
                    {selected.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
              <button
                className="block-btn inline-flex items-center gap-1 text-xs px-3 py-1.5"
                onClick={() => handleEdit(selected)}
              >
                <Edit2 size={11} /> Edit
              </button>
            </div>

            {/* Config blocks */}
            {[
              { label: 'Trigger Config', value: selected.trigger_config },
              { label: 'Conditions', value: selected.conditions },
              { label: 'Actions', value: selected.actions },
            ].map(({ label, value }) => {
              let parsed: any;
              try { parsed = JSON.parse(value); } catch { parsed = value; }
              return (
                <div key={label} className="block-card p-4" style={{ borderRadius: '6px' }}>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-2">{label}</p>
                  <pre className="text-xs font-mono text-text-secondary overflow-x-auto whitespace-pre-wrap bg-bg-tertiary p-3" style={{ borderRadius: '6px' }}>
                    {typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2)}
                  </pre>
                </div>
              );
            })}

            {/* Run log */}
            <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
              <div className="px-4 py-3 border-b border-border-primary">
                <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Run Log</p>
              </div>
              {loadingLog ? (
                <div className="p-4 text-xs text-text-muted italic">Loading...</div>
              ) : runLog.length === 0 ? (
                <div className="p-4 text-xs text-text-muted italic">No runs recorded yet</div>
              ) : (
                <table className="block-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Status</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runLog.map((entry) => (
                      <tr key={entry.id}>
                        <td className="font-mono text-xs text-text-muted whitespace-nowrap">{formatDate(entry.ran_at)}</td>
                        <td><StatusBadge status={entry.status} /></td>
                        <td className="text-xs text-text-secondary">{entry.detail ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
    </div>
  );
};

// ─── Top-level Automations Module with tabs ──────────────
const AutomationsModule: React.FC = () => {
  const [tab, setTab] = useState<AutomationTab>('workflows');
  const [workflowView, setWorkflowView] = useState<'list' | 'edit'>('list');
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null);

  const tabs: { id: AutomationTab; label: string; icon: React.ReactNode }[] = [
    { id: 'workflows', label: 'Workflows', icon: <GitBranch size={12} /> },
    { id: 'rules', label: 'Rules (Legacy)', icon: <Zap size={12} /> },
    { id: 'execution-log', label: 'Activity', icon: <History size={12} /> },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tab bar */}
      <div className="border-b-2 border-border-primary bg-bg-secondary px-4 py-2 flex items-center gap-1 shrink-0">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                if (t.id === 'workflows') {
                  setWorkflowView('list');
                  setEditingWorkflowId(null);
                }
              }}
              className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 transition-colors ${
                active
                  ? 'bg-bg-primary text-text-primary border border-border-primary'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
              }`}
              style={{ borderRadius: '6px' }}
            >
              {t.icon}
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'rules' && <RulesTab />}

        {tab === 'workflows' && (
          <div className="h-full overflow-y-auto bg-bg-primary p-6">
            {workflowView === 'list' ? (
              <WorkflowList
                onNew={() => {
                  setEditingWorkflowId(null);
                  setWorkflowView('edit');
                }}
                onEdit={(id) => {
                  setEditingWorkflowId(id);
                  setWorkflowView('edit');
                }}
              />
            ) : (
              <WorkflowBuilder
                workflowId={editingWorkflowId}
                onSaved={() => {
                  setWorkflowView('list');
                  setEditingWorkflowId(null);
                }}
                onCancel={() => {
                  setWorkflowView('list');
                  setEditingWorkflowId(null);
                }}
              />
            )}
          </div>
        )}

        {tab === 'execution-log' && (
          <div className="h-full overflow-y-auto bg-bg-primary p-6">
            <WorkflowExecutionLog />
          </div>
        )}
      </div>
    </div>
  );
};

export default AutomationsModule;
