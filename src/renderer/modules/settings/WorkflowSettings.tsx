import React, { useEffect, useState, useCallback } from 'react';
import { Workflow, Plus, Trash2, Save, Send } from 'lucide-react';
import { useCompanyStore } from '../../stores/companyStore';

interface EmailSchedule {
  id: string;
  company_id: string;
  template_key: string;
  trigger_event: string;
  delay_days: number;
  condition_json: string;
  enabled: number;
}

interface EmailTemplate {
  key: string;
  label: string;
}

const TRIGGER_EVENTS = [
  { value: 'invoice_due', label: 'Invoice past due' },
  { value: 'invoice_sent', label: 'After invoice sent' },
  { value: 'quote_sent', label: 'After quote sent' },
  { value: 'debt_created', label: 'Debt created' },
  { value: 'manual', label: 'Manual only' },
];

function ipc(channel: string, payload?: any): Promise<any> {
  return (window as any).electronAPI.invoke(channel, payload);
}

const WorkflowSettings: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [schedules, setSchedules] = useState<EmailSchedule[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);

  const load = useCallback(async () => {
    if (!activeCompany) return;
    const rows = await ipc('db:query', { table: 'email_schedules', filters: { company_id: activeCompany.id } });
    if (Array.isArray(rows)) setSchedules(rows);
    const t = await ipc('email-tmpl:list', { companyId: activeCompany.id });
    if (Array.isArray(t)) setTemplates(t);
  }, [activeCompany]);

  useEffect(() => { load(); }, [load]);

  const addSchedule = async () => {
    if (!activeCompany || templates.length === 0) return;
    await ipc('db:create', { table: 'email_schedules', data: {
      company_id: activeCompany.id,
      template_key: templates[0].key,
      trigger_event: 'invoice_due',
      delay_days: 7,
      condition_json: '{}',
      enabled: 1,
    } });
    await load();
  };

  const updateField = (id: string, field: keyof EmailSchedule, value: any) => {
    setSchedules(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const save = async (s: EmailSchedule) => {
    await ipc('db:update', { table: 'email_schedules', id: s.id, data: {
      template_key: s.template_key,
      trigger_event: s.trigger_event,
      delay_days: Number(s.delay_days) || 0,
      condition_json: s.condition_json || '{}',
      enabled: s.enabled ? 1 : 0,
    } });
    await load();
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this schedule?')) return;
    await ipc('db:delete', { table: 'email_schedules', id });
    await load();
  };

  if (!activeCompany) return null;

  return (
    <div className="block-card space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 flex items-center justify-center bg-bg-tertiary border border-border-primary shrink-0" style={{ borderRadius: '6px' }}>
          <Workflow size={16} className="text-accent-blue" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Workflow Automation</h3>
          <p className="text-xs text-text-muted mt-0.5">Schedule email templates against trigger events (e.g., "send reminder 7 days past due").</p>
        </div>
      </div>
      <div className="border-t border-border-primary pt-4 space-y-2">
        <button className="block-btn text-xs flex items-center gap-1" onClick={addSchedule} disabled={templates.length === 0}>
          <Plus size={12} /> Add Schedule
        </button>
        {schedules.length === 0 && (
          <p className="text-xs text-text-muted">No automation schedules yet.</p>
        )}
        {schedules.map(s => (
          <div key={s.id} className="grid grid-cols-12 gap-2 items-center text-xs p-2 border border-border-primary" style={{ borderRadius: '6px' }}>
            <select className="block-input text-xs col-span-3" value={s.template_key} onChange={e => updateField(s.id, 'template_key', e.target.value)}>
              {templates.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
            <select className="block-input text-xs col-span-3" value={s.trigger_event} onChange={e => updateField(s.id, 'trigger_event', e.target.value)}>
              {TRIGGER_EVENTS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
            </select>
            <div className="col-span-2 flex items-center gap-1">
              <input type="number" className="block-input text-xs flex-1" value={s.delay_days} onChange={e => updateField(s.id, 'delay_days', parseInt(e.target.value) || 0)} />
              <span className="text-text-muted">days</span>
            </div>
            <label className="col-span-1 flex items-center gap-1">
              <input type="checkbox" checked={!!s.enabled} onChange={e => updateField(s.id, 'enabled', e.target.checked ? 1 : 0)} /> on
            </label>
            <input className="block-input text-xs col-span-2" placeholder="condition JSON" value={s.condition_json || '{}'} onChange={e => updateField(s.id, 'condition_json', e.target.value)} />
            <div className="col-span-1 flex gap-1">
              <button className="block-btn-primary text-xs" onClick={() => save(s)}><Save size={11} /></button>
              <button className="block-btn-danger text-xs" onClick={() => remove(s.id)}><Trash2 size={11} /></button>
            </div>
          </div>
        ))}
        <p className="text-[11px] text-text-muted mt-2 flex items-start gap-1">
          <Send size={11} className="mt-0.5" />
          Schedules are evaluated by the notification engine on its next run.
        </p>
      </div>
    </div>
  );
};

export default WorkflowSettings;
