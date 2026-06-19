import React, { useEffect, useMemo, useState } from 'react';
import {
  GitBranch,
  Zap,
  Plus,
  Trash2,
  Save,
  X,
  ChevronDown,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';
import api from '../../lib/api';
import ErrorBanner from '../../components/ErrorBanner';

interface WorkflowBuilderProps {
  workflowId: string | null;
  onSaved: () => void;
  onCancel: () => void;
}

interface ConditionRow {
  field: string;
  op: string;
  value: string;
}

interface ActionRow {
  type: string;
  config: Record<string, any>;
}

interface Workflow {
  id: string;
  name: string;
  description?: string | null;
  trigger_type: string;
  trigger_config_json: string | null;
  conditions_json: string | null;
  actions_json: string | null;
  is_active: number;
  rate_limit_per_hour?: number | null;
  requires_approval?: number | null;
}

const EVENT_TYPES: { group: string; items: string[] }[] = [
  {
    group: 'Invoice',
    items: [
      'invoice.created',
      'invoice.updated',
      'invoice.deleted',
      'invoice.sent',
      'invoice.viewed',
      'invoice.paid',
      'invoice.partial_paid',
      'invoice.overdue',
      'invoice.voided',
    ],
  },
  {
    group: 'Expense',
    items: ['expense.created', 'expense.updated', 'expense.approved', 'expense.rejected', 'expense.reimbursed'],
  },
  {
    group: 'Payment',
    items: ['payment.received', 'payment.refunded'],
  },
  {
    group: 'Client/Vendor',
    items: ['client.created', 'client.updated', 'client.status_changed', 'vendor.created', 'vendor.updated'],
  },
  {
    group: 'Quote',
    items: ['quote.created', 'quote.sent', 'quote.accepted', 'quote.rejected', 'quote.converted', 'quote.expired'],
  },
  {
    group: 'Debt',
    items: ['debt.created', 'debt.escalated', 'debt.payment_received', 'debt.settled', 'debt.closed', 'debt.written_off'],
  },
  {
    group: 'Payroll',
    items: ['payroll.processed', 'payroll.paid'],
  },
  {
    group: 'Project',
    items: ['project.created', 'project.budget_warning', 'project.completed'],
  },
  {
    group: 'Tax',
    items: ['tax.filing_due', 'tax.deposit_due'],
  },
];

const OPS: { value: string; label: string }[] = [
  { value: 'eq', label: '= (equals)' },
  { value: 'neq', label: '≠ (not equal)' },
  { value: 'gt', label: '> (greater)' },
  { value: 'gte', label: '≥ (greater/equal)' },
  { value: 'lt', label: '< (less)' },
  { value: 'lte', label: '≤ (less/equal)' },
  { value: 'contains', label: 'contains' },
  { value: 'in', label: 'in (CSV list)' },
  { value: 'exists', label: 'exists' },
];

const ACTION_TYPES: { value: string; label: string }[] = [
  { value: 'send_notification', label: 'Send Notification' },
  { value: 'log_audit', label: 'Log Audit Entry' },
  { value: 'webhook', label: 'Call Webhook' },
  { value: 'trigger_macro', label: 'Trigger Macro' },
];

const NOTIFICATION_TYPES = ['info', 'success', 'warning', 'error'];

const LABEL_CLASS = 'text-[10px] font-semibold text-text-muted uppercase tracking-wider';

function safeParseArray(raw: string | null | undefined): any[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function safeParseObj(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

const WorkflowBuilder: React.FC<WorkflowBuilderProps> = ({ workflowId, onSaved, onCancel }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [triggerType, setTriggerType] = useState<'event'>('event');
  const [eventType, setEventType] = useState('invoice.created');
  const [conditions, setConditions] = useState<ConditionRow[]>([]);
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [rateLimit, setRateLimit] = useState<number>(0);
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isEdit = workflowId !== null;

  useEffect(() => {
    let cancelled = false;
    if (!workflowId) return;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const all = (await api.listWorkflows()) as Workflow[];
        const wf = (all ?? []).find((w) => w.id === workflowId);
        if (!wf) {
          if (!cancelled) setError('Workflow not found');
          return;
        }
        if (cancelled) return;
        setName(wf.name ?? '');
        setDescription(wf.description ?? '');
        setIsActive(wf.is_active === 1);
        setTriggerType((wf.trigger_type as 'event') ?? 'event');
        const cfg = safeParseObj(wf.trigger_config_json);
        if (typeof cfg.event_type === 'string') setEventType(cfg.event_type);
        const conds = safeParseArray(wf.conditions_json);
        setConditions(
          conds.map((c) => ({
            field: String(c?.field ?? ''),
            op: String(c?.op ?? 'eq'),
            value: c?.value !== undefined && c?.value !== null ? String(c.value) : '',
          }))
        );
        const acts = safeParseArray(wf.actions_json);
        setActions(
          acts.map((a) => ({
            type: String(a?.type ?? 'send_notification'),
            config: a?.config && typeof a.config === 'object' ? a.config : {},
          }))
        );
        setRateLimit(Number(wf.rate_limit_per_hour ?? 0));
        setRequiresApproval(wf.requires_approval === 1);
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? 'Failed to load workflow');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workflowId]);

  const allEventTypes = useMemo(() => EVENT_TYPES.flatMap((g) => g.items), []);

  const addCondition = () =>
    setConditions((c) => [...c, { field: '', op: 'eq', value: '' }]);
  const removeCondition = (idx: number) =>
    setConditions((c) => c.filter((_, i) => i !== idx));
  const updateCondition = (idx: number, patch: Partial<ConditionRow>) =>
    setConditions((c) => c.map((row, i) => (i === idx ? { ...row, ...patch } : row)));

  const addAction = () =>
    setActions((a) => [...a, { type: 'send_notification', config: { message: '', notification_type: 'info' } }]);
  const removeAction = (idx: number) =>
    setActions((a) => a.filter((_, i) => i !== idx));
  const updateAction = (idx: number, patch: Partial<ActionRow>) =>
    setActions((a) => a.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  const updateActionConfig = (idx: number, key: string, value: any) =>
    setActions((a) =>
      a.map((row, i) => (i === idx ? { ...row, config: { ...row.config, [key]: value } } : row))
    );

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (!eventType) {
      setError('Event type is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      // Strip empty condition rows so we don't save junk.
      const cleanConditions = conditions
        .filter((c) => c.field.trim().length > 0)
        .map((c) => ({ field: c.field.trim(), op: c.op, value: c.value }));

      await api.saveWorkflow({
        id: workflowId ?? undefined,
        name: name.trim(),
        description: description.trim(),
        trigger_type: triggerType,
        trigger_config: { event_type: eventType },
        conditions: cleanConditions,
        actions,
        is_active: isActive ? 1 : 0,
        rate_limit_per_hour: rateLimit,
        requires_approval: requiresApproval ? 1 : 0,
      });
      onSaved();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save workflow');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="block-card p-6 text-xs text-text-muted italic" style={{ borderRadius: '6px' }}>
        Loading workflow…
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-4xl">
      {error && <ErrorBanner message={error} title="Workflow error" onDismiss={() => setError('')} />}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch size={16} className="text-text-primary" strokeWidth={2.5} />
          <h2 className="text-sm font-black uppercase tracking-wider text-text-primary">
            {isEdit ? 'Edit Workflow' : 'New Workflow'}
          </h2>
        </div>
        <div className="flex gap-2">
          <button
            className="block-btn inline-flex items-center gap-1 text-xs px-3 py-1.5"
            onClick={onCancel}
            disabled={saving}
            style={{ borderRadius: '6px' }}
          >
            <X size={12} /> Cancel
          </button>
          <button
            className="block-btn-primary inline-flex items-center gap-1.5 text-xs px-4 py-1.5 font-semibold"
            onClick={handleSave}
            disabled={saving || !name.trim()}
            style={{ borderRadius: '6px' }}
          >
            <Save size={12} /> {saving ? 'Saving…' : 'Save Workflow'}
          </button>
        </div>
      </div>

      {/* Basic Info */}
      <div className="block-card p-4 space-y-3" style={{ borderRadius: '6px' }}>
        <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Basic Info</p>
        <div>
          <label className={`block ${LABEL_CLASS} mb-1`}>Name *</label>
          <input
            className="block-input w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Notify finance when an invoice is paid"
          />
        </div>
        <div>
          <label className={`block ${LABEL_CLASS} mb-1`}>Description</label>
          <textarea
            className="block-input w-full"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this workflow does, when it should run, who owns it…"
            style={{ resize: 'vertical' }}
          />
        </div>
        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="accent-accent-income"
          />
          <span className="text-xs text-text-secondary">Active (workflow runs when triggered)</span>
        </label>
      </div>

      {/* Trigger */}
      <div className="block-card p-4 space-y-3" style={{ borderRadius: '6px' }}>
        <div className="flex items-center gap-2">
          <Zap size={12} className="text-accent-blue" />
          <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Trigger</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={`block ${LABEL_CLASS} mb-1`}>Trigger Type</label>
            <select
              className="block-select w-full"
              value={triggerType}
              onChange={(e) => setTriggerType(e.target.value as 'event')}
            >
              <option value="event">Event</option>
            </select>
            <p className="text-[10px] text-text-muted mt-1">Only event triggers are supported in this release.</p>
          </div>
          <div>
            <label className={`block ${LABEL_CLASS} mb-1`}>Event Type *</label>
            <select
              className="block-select w-full font-mono"
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
            >
              {EVENT_TYPES.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.items.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </optgroup>
              ))}
              {/* fallback if loaded value isn't in the catalog */}
              {!allEventTypes.includes(eventType) && (
                <option value={eventType}>{eventType} (custom)</option>
              )}
            </select>
          </div>
        </div>
      </div>

      {/* Conditions */}
      <div className="block-card p-4 space-y-3" style={{ borderRadius: '6px' }}>
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Conditions</p>
          <button
            className="block-btn inline-flex items-center gap-1 text-[10px] px-2 py-1"
            onClick={addCondition}
            type="button"
            style={{ borderRadius: '6px' }}
          >
            <Plus size={10} /> Add Condition
          </button>
        </div>
        {conditions.length === 0 ? (
          <p className="text-xs text-text-muted italic">
            No conditions — workflow runs on every matching event.
          </p>
        ) : (
          <div className="space-y-2">
            {conditions.map((c, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-start">
                <input
                  className="block-input col-span-4 font-mono"
                  placeholder="payload.amount"
                  value={c.field}
                  onChange={(e) => updateCondition(idx, { field: e.target.value })}
                />
                <select
                  className="block-select col-span-3"
                  value={c.op}
                  onChange={(e) => updateCondition(idx, { op: e.target.value })}
                >
                  {OPS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <input
                  className="block-input col-span-4 font-mono"
                  placeholder={c.op === 'in' ? 'a,b,c' : 'value'}
                  value={c.value}
                  onChange={(e) => updateCondition(idx, { value: e.target.value })}
                  disabled={c.op === 'exists'}
                />
                <button
                  className="text-text-muted hover:text-accent-expense p-1 col-span-1 justify-self-center"
                  onClick={() => removeCondition(idx)}
                  type="button"
                  title="Remove condition"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="text-[10px] text-text-muted">
          Field paths are dot-notation against the event payload (e.g. <span className="font-mono">payload.amount</span>).
        </p>
      </div>

      {/* Actions */}
      <div className="block-card p-4 space-y-3" style={{ borderRadius: '6px' }}>
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Actions</p>
          <button
            className="block-btn inline-flex items-center gap-1 text-[10px] px-2 py-1"
            onClick={addAction}
            type="button"
            style={{ borderRadius: '6px' }}
          >
            <Plus size={10} /> Add Action
          </button>
        </div>
        {actions.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-text-muted italic">
            <AlertCircle size={12} /> No actions — workflow will record an execution but do nothing.
          </div>
        ) : (
          <div className="space-y-3">
            {actions.map((a, idx) => (
              <div
                key={idx}
                className="border border-border-secondary p-3 space-y-2"
                style={{ borderRadius: '6px' }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-text-muted">#{idx + 1}</span>
                  <select
                    className="block-select flex-1"
                    value={a.type}
                    onChange={(e) => {
                      const newType = e.target.value;
                      // reset config to sensible defaults for the new type
                      let cfg: Record<string, any> = {};
                      if (newType === 'send_notification') {
                        cfg = { message: '', notification_type: 'info' };
                      } else if (newType === 'log_audit') {
                        cfg = { message: '' };
                      } else if (newType === 'webhook') {
                        cfg = { url: '', method: 'POST' };
                      } else if (newType === 'trigger_macro') {
                        cfg = { macro_id: '' };
                      }
                      updateAction(idx, { type: newType, config: cfg });
                    }}
                  >
                    {ACTION_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="text-text-muted hover:text-accent-expense p-1"
                    onClick={() => removeAction(idx)}
                    type="button"
                    title="Remove action"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>

                {/* Per-type config */}
                {a.type === 'send_notification' && (
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                      <label className={`block ${LABEL_CLASS} mb-1`}>Message</label>
                      <input
                        className="block-input w-full"
                        value={a.config.message ?? ''}
                        onChange={(e) => updateActionConfig(idx, 'message', e.target.value)}
                        placeholder="Invoice {{number}} was paid"
                      />
                    </div>
                    <div>
                      <label className={`block ${LABEL_CLASS} mb-1`}>Type</label>
                      <select
                        className="block-select w-full"
                        value={a.config.notification_type ?? 'info'}
                        onChange={(e) => updateActionConfig(idx, 'notification_type', e.target.value)}
                      >
                        {NOTIFICATION_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {a.type === 'log_audit' && (
                  <div>
                    <label className={`block ${LABEL_CLASS} mb-1`}>Audit Message</label>
                    <input
                      className="block-input w-full"
                      value={a.config.message ?? ''}
                      onChange={(e) => updateActionConfig(idx, 'message', e.target.value)}
                      placeholder="Audit entry for matched event"
                    />
                  </div>
                )}

                {a.type === 'webhook' && (
                  <div className="grid grid-cols-4 gap-2">
                    <div className="col-span-3">
                      <label className={`block ${LABEL_CLASS} mb-1`}>Webhook URL</label>
                      <input
                        className="block-input w-full font-mono"
                        value={a.config.url ?? ''}
                        onChange={(e) => updateActionConfig(idx, 'url', e.target.value)}
                        placeholder="https://example.com/hook"
                      />
                    </div>
                    <div>
                      <label className={`block ${LABEL_CLASS} mb-1`}>Method</label>
                      <select
                        className="block-select w-full"
                        value={a.config.method ?? 'POST'}
                        onChange={(e) => updateActionConfig(idx, 'method', e.target.value)}
                      >
                        {['POST', 'PUT', 'GET'].map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {a.type === 'trigger_macro' && (
                  <div>
                    <label className={`block ${LABEL_CLASS} mb-1`}>Macro ID</label>
                    <input
                      className="block-input w-full font-mono"
                      value={a.config.macro_id ?? ''}
                      onChange={(e) => updateActionConfig(idx, 'macro_id', e.target.value)}
                      placeholder="macro_xxxxxxxx"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Advanced */}
      <div className="block-card p-0" style={{ borderRadius: '6px' }}>
        <button
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-bg-hover transition-colors"
          type="button"
          onClick={() => setAdvancedOpen((o) => !o)}
        >
          <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Advanced</span>
          {advancedOpen ? (
            <ChevronDown size={14} className="text-text-muted" />
          ) : (
            <ChevronRight size={14} className="text-text-muted" />
          )}
        </button>
        {advancedOpen && (
          <div className="px-4 pb-4 space-y-3 border-t border-border-primary pt-3">
            <div>
              <label className={`block ${LABEL_CLASS} mb-1`}>Rate Limit (per hour)</label>
              <input
                type="number"
                min={0}
                className="block-input w-32 font-mono"
                value={rateLimit}
                onChange={(e) => setRateLimit(parseInt(e.target.value, 10) || 0)}
              />
              <p className="text-[10px] text-text-muted mt-1">
                Max executions per hour. <span className="font-mono">0</span> = unlimited.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={requiresApproval}
                onChange={(e) => setRequiresApproval(e.target.checked)}
                className="accent-accent-blue"
              />
              <span className="text-xs text-text-secondary">Require manual approval before actions run</span>
            </label>
          </div>
        )}
      </div>

      {/* Footer save */}
      <div className="flex justify-end gap-2 pt-2">
        <button
          className="block-btn inline-flex items-center gap-1 text-xs px-4 py-2"
          onClick={onCancel}
          disabled={saving}
          style={{ borderRadius: '6px' }}
        >
          <X size={12} /> Cancel
        </button>
        <button
          className="block-btn-primary inline-flex items-center gap-1.5 text-xs px-4 py-2 font-semibold"
          onClick={handleSave}
          disabled={saving || !name.trim()}
          style={{ borderRadius: '6px' }}
        >
          <Save size={12} /> {saving ? 'Saving…' : 'Save Workflow'}
        </button>
      </div>
    </div>
  );
};

export default WorkflowBuilder;
