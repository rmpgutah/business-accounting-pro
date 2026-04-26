import React, { useEffect, useState, useCallback } from 'react';
import { GitBranch, Save, Plus, Trash2, ArrowRight } from 'lucide-react';
import { useCompanyStore } from '../../stores/companyStore';

interface CustomStatus {
  id: string;
  company_id: string;
  entity_type: string;
  key: string;
  label: string;
  color: string;
  icon: string;
  sort_order: number;
  is_terminal: number;
  allows_edit: number;
  requires_approval: number;
  sla_max_days: number | null;
  notify_users: string;
}

interface StatusTransition {
  id: string;
  company_id: string;
  entity_type: string;
  from_status: string;
  to_status: string;
  requires_role: string;
  requires_comment: number;
  requires_approval: number;
}

const ENTITIES = ['invoice','quote','expense','bill','debt','project','purchase_order','journal_entry'];
const ENTITY_LABELS: Record<string, string> = {
  invoice: 'Invoices', quote: 'Quotes', expense: 'Expenses', bill: 'Bills',
  debt: 'Debts', project: 'Projects', purchase_order: 'Purchase Orders', journal_entry: 'Journal Entries',
};

function ipc(channel: string, payload?: any): Promise<any> {
  return (window as any).electronAPI.invoke(channel, payload);
}

const StatusBuilderSettings: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [entityType, setEntityType] = useState<string>('invoice');
  const [statuses, setStatuses] = useState<CustomStatus[]>([]);
  const [transitions, setTransitions] = useState<StatusTransition[]>([]);
  const [savingId, setSavingId] = useState<string>('');

  const load = useCallback(async () => {
    if (!activeCompany) return;
    const s = await ipc('workflow:statuses-list', { companyId: activeCompany.id, entityType });
    if (Array.isArray(s)) setStatuses(s);
    const t = await ipc('workflow:transitions-list', { companyId: activeCompany.id, entityType });
    if (Array.isArray(t)) setTransitions(t);
  }, [activeCompany, entityType]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = (id: string, field: keyof CustomStatus, value: any) => {
    setStatuses(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const saveStatus = async (s: CustomStatus) => {
    setSavingId(s.id);
    try {
      await ipc('db:update', { table: 'custom_statuses', id: s.id, data: {
        label: s.label, color: s.color, icon: s.icon, sort_order: s.sort_order,
        is_terminal: s.is_terminal ? 1 : 0,
        allows_edit: s.allows_edit ? 1 : 0,
        requires_approval: s.requires_approval ? 1 : 0,
        sla_max_days: s.sla_max_days,
        notify_users: s.notify_users || '',
      } });
      await load();
    } finally { setSavingId(''); }
  };

  const addStatus = async () => {
    if (!activeCompany) return;
    const key = window.prompt('Status key (lowercase, no spaces):');
    if (!key) return;
    const label = window.prompt('Status label:', key) || key;
    await ipc('db:create', { table: 'custom_statuses', data: {
      company_id: activeCompany.id, entity_type: entityType, key, label,
      color: '#6b7280', icon: 'Circle', sort_order: statuses.length,
    } });
    await load();
  };

  const deleteStatus = async (id: string) => {
    if (!window.confirm('Delete this status?')) return;
    await ipc('db:delete', { table: 'custom_statuses', id });
    await load();
  };

  const addTransition = async () => {
    if (!activeCompany || statuses.length < 2) return;
    await ipc('db:create', { table: 'status_transitions', data: {
      company_id: activeCompany.id, entity_type: entityType,
      from_status: statuses[0].key, to_status: statuses[1].key,
      requires_role: '', requires_comment: 0, requires_approval: 0,
    } });
    await load();
  };

  const updateTransition = (id: string, field: keyof StatusTransition, value: any) => {
    setTransitions(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t));
  };

  const saveTransition = async (t: StatusTransition) => {
    await ipc('db:update', { table: 'status_transitions', id: t.id, data: {
      from_status: t.from_status, to_status: t.to_status,
      requires_role: t.requires_role || '',
      requires_comment: t.requires_comment ? 1 : 0,
      requires_approval: t.requires_approval ? 1 : 0,
    } });
    await load();
  };

  const deleteTransition = async (id: string) => {
    await ipc('db:delete', { table: 'status_transitions', id });
    await load();
  };

  if (!activeCompany) return null;

  return (
    <div className="block-card space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 flex items-center justify-center bg-bg-tertiary border border-border-primary shrink-0" style={{ borderRadius: '6px' }}>
          <GitBranch size={16} className="text-accent-blue" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Status Builder</h3>
          <p className="text-xs text-text-muted mt-0.5">Define custom statuses, transitions, SLAs, and notifications per record type.</p>
        </div>
      </div>
      <div className="border-t border-border-primary pt-4 space-y-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-muted">Entity:</label>
          <select className="block-input text-xs" value={entityType} onChange={e => setEntityType(e.target.value)}>
            {ENTITIES.map(e => <option key={e} value={e}>{ENTITY_LABELS[e]}</option>)}
          </select>
          <button className="block-btn text-xs ml-auto flex items-center gap-1" onClick={addStatus}>
            <Plus size={12} /> Add Status
          </button>
        </div>

        {/* Statuses table */}
        <div className="space-y-2">
          {statuses.map(s => (
            <div key={s.id} className="p-2 border border-border-primary text-xs" style={{ borderRadius: '6px' }}>
              <div className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-2">
                  <span className="inline-flex items-center gap-1 px-2 py-1" style={{ borderRadius: '4px', background: s.color + '22', color: s.color, border: `1px solid ${s.color}` }}>
                    {s.label}
                  </span>
                </div>
                <input className="block-input text-xs col-span-2" value={s.label} onChange={e => updateStatus(s.id, 'label', e.target.value)} />
                <input type="color" className="col-span-1 h-7 w-full" value={s.color} onChange={e => updateStatus(s.id, 'color', e.target.value)} />
                <input className="block-input text-xs col-span-2" placeholder="icon" value={s.icon} onChange={e => updateStatus(s.id, 'icon', e.target.value)} />
                <input type="number" className="block-input text-xs col-span-1" placeholder="SLA d" value={s.sla_max_days ?? ''} onChange={e => updateStatus(s.id, 'sla_max_days', e.target.value ? parseInt(e.target.value) : null)} />
                <label className="col-span-1 flex items-center gap-1"><input type="checkbox" checked={!!s.is_terminal} onChange={e => updateStatus(s.id, 'is_terminal', e.target.checked ? 1 : 0)} /> term</label>
                <label className="col-span-1 flex items-center gap-1"><input type="checkbox" checked={!!s.requires_approval} onChange={e => updateStatus(s.id, 'requires_approval', e.target.checked ? 1 : 0)} /> appr</label>
                <div className="col-span-2 flex items-center gap-1">
                  <button className="block-btn-primary text-xs" disabled={savingId === s.id} onClick={() => saveStatus(s)}>
                    {savingId === s.id ? '…' : 'Save'}
                  </button>
                  <button className="block-btn-danger text-xs" onClick={() => deleteStatus(s.id)}><Trash2 size={11} /></button>
                </div>
              </div>
              <div className="mt-2">
                <input className="block-input text-xs w-full" placeholder="Notify (comma-separated user IDs)" value={s.notify_users || ''} onChange={e => updateStatus(s.id, 'notify_users', e.target.value)} />
              </div>
            </div>
          ))}
        </div>

        {/* Transitions */}
        <div className="border-t border-border-primary pt-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-text-primary">Allowed Transitions</h4>
            <button className="block-btn text-xs flex items-center gap-1" onClick={addTransition} disabled={statuses.length < 2}>
              <Plus size={12} /> Add
            </button>
          </div>
          {transitions.length === 0 && (
            <p className="text-xs text-text-muted">If empty, all transitions are allowed.</p>
          )}
          <div className="space-y-1">
            {transitions.map(t => (
              <div key={t.id} className="grid grid-cols-12 gap-2 items-center text-xs">
                <select className="block-input text-xs col-span-3" value={t.from_status} onChange={e => updateTransition(t.id, 'from_status', e.target.value)}>
                  {statuses.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
                <ArrowRight size={12} className="col-span-1 mx-auto text-text-muted" />
                <select className="block-input text-xs col-span-3" value={t.to_status} onChange={e => updateTransition(t.id, 'to_status', e.target.value)}>
                  {statuses.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
                <label className="col-span-1 flex items-center gap-1"><input type="checkbox" checked={!!t.requires_comment} onChange={e => updateTransition(t.id, 'requires_comment', e.target.checked ? 1 : 0)} /> cmt</label>
                <label className="col-span-1 flex items-center gap-1"><input type="checkbox" checked={!!t.requires_approval} onChange={e => updateTransition(t.id, 'requires_approval', e.target.checked ? 1 : 0)} /> appr</label>
                <input className="block-input text-xs col-span-2" placeholder="role" value={t.requires_role || ''} onChange={e => updateTransition(t.id, 'requires_role', e.target.value)} />
                <div className="col-span-1 flex gap-1">
                  <button className="block-btn-primary text-xs" onClick={() => saveTransition(t)}><Save size={11} /></button>
                  <button className="block-btn-danger text-xs" onClick={() => deleteTransition(t.id)}><Trash2 size={11} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Workflow diagram */}
        <div className="border-t border-border-primary pt-3">
          <h4 className="text-sm font-semibold text-text-primary mb-2">Workflow Diagram</h4>
          <WorkflowDiagram statuses={statuses} transitions={transitions} />
        </div>
      </div>
    </div>
  );
};

const WorkflowDiagram: React.FC<{ statuses: CustomStatus[]; transitions: StatusTransition[] }> = ({ statuses, transitions }) => {
  if (statuses.length === 0) return <p className="text-xs text-text-muted">No statuses defined.</p>;
  const nodeWidth = 100;
  const nodeHeight = 36;
  const cols = 3;
  const positions: Record<string, { x: number; y: number }> = {};
  statuses.forEach((s, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    positions[s.key] = { x: col * (nodeWidth + 80) + 20, y: row * (nodeHeight + 50) + 20 };
  });
  const rows = Math.ceil(statuses.length / cols);
  const width = cols * (nodeWidth + 80) + 20;
  const height = rows * (nodeHeight + 50) + 40;

  // If no transitions defined, draw default linear chain
  const lines = transitions.length > 0
    ? transitions.map(t => ({ from: t.from_status, to: t.to_status }))
    : statuses.slice(0, -1).map((s, i) => ({ from: s.key, to: statuses[i + 1].key }));

  return (
    <div className="border border-border-primary p-2 overflow-auto" style={{ borderRadius: '6px', maxHeight: 280 }}>
      <svg width={width} height={height} style={{ minWidth: width }}>
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L0,8 L8,4 z" fill="#94a3b8" />
          </marker>
        </defs>
        {lines.map((l, i) => {
          const a = positions[l.from]; const b = positions[l.to];
          if (!a || !b) return null;
          const x1 = a.x + nodeWidth / 2;
          const y1 = a.y + nodeHeight;
          const x2 = b.x + nodeWidth / 2;
          const y2 = b.y;
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#94a3b8" strokeWidth="1.5" markerEnd="url(#arrow)" />;
        })}
        {statuses.map(s => {
          const p = positions[s.key];
          return (
            <g key={s.key} transform={`translate(${p.x},${p.y})`}>
              <rect width={nodeWidth} height={nodeHeight} rx={4} fill={s.color + '22'} stroke={s.color} strokeWidth="1.5" />
              <text x={nodeWidth / 2} y={nodeHeight / 2 + 4} textAnchor="middle" fontSize="11" fill={s.color} fontWeight="600">
                {s.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

export default StatusBuilderSettings;
