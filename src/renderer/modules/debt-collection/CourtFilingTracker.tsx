import React, { useEffect, useState, useCallback } from 'react';
import { Gavel, Plus, Check, AlertTriangle, Clock } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate, formatStatus } from '../../lib/format';

// ─── Types ──────────────────────────────────────────────
interface CourtFilingTrackerProps {
  debtId: string;
}

interface ChecklistItem {
  title: string;
  completed: boolean;
  completed_date: string | null;
  notes: string;
}

interface LegalAction {
  id: string;
  debt_id: string;
  action_type: string;
  status: string;
  court_name: string;
  court_address: string;
  case_number: string;
  hearing_date: string | null;
  hearing_time: string;
  attorney_id: string;
  court_costs: number;
  checklist_json: string;
  created_at: string;
}

interface Attorney {
  id: string;
  name: string;
}

interface NewFilingForm {
  action_type: string;
  court_name: string;
  court_address: string;
  case_number: string;
  hearing_date: string;
  hearing_time: string;
  attorney_id: string;
  court_costs: string;
}

// ─── Default checklists by type ─────────────────────────
const DEFAULT_CHECKLISTS: Record<string, string[]> = {
  small_claims: [
    'Verify statute of limitations',
    'Calculate total claim',
    'Prepare demand letter proof',
    'Compile evidence package',
    'Complete filing form',
    'Pay filing fee',
    'Serve defendant',
    'File proof of service',
    'Prepare court summary',
  ],
  civil_suit: [
    'Verify statute of limitations',
    'Draft complaint',
    'Calculate damages',
    'File complaint with court',
    'Pay filing fee',
    'Serve defendant',
    'Await response/answer',
    'Discovery preparation',
    'Pre-trial motions',
    'Trial preparation',
  ],
};

const GENERIC_CHECKLIST = [
  'Prepare documentation',
  'File paperwork',
  'Serve parties',
  'Follow up',
];

function getDefaultChecklist(actionType: string): ChecklistItem[] {
  const titles = DEFAULT_CHECKLISTS[actionType] || GENERIC_CHECKLIST;
  return titles.map((title) => ({
    title,
    completed: false,
    completed_date: null,
    notes: '',
  }));
}

const ACTION_TYPES = [
  { value: 'arbitration', label: 'Arbitration' },
  { value: 'civil_suit', label: 'Civil Suit' },
  { value: 'demand_letter', label: 'Demand Letter' },
  { value: 'garnishment_order', label: 'Garnishment Order' },
  { value: 'lien', label: 'Lien' },
  { value: 'mediation', label: 'Mediation' },
  { value: 'small_claims', label: 'Small Claims' },
];

// Status options sorted alphabetically by label per directive (semantic workflow order is preparing → filed → served → hearing_scheduled → in_progress → judgment → appeal → closed).
const STATUS_OPTIONS = [
  'appeal',
  'closed',
  'filed',
  'hearing_scheduled',
  'in_progress',
  'judgment',
  'preparing',
  'served',
];

function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ─── Helpers ────────────────────────────────────────────
function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr).getTime();
  if (isNaN(d)) return null;
  return Math.floor((d - Date.now()) / 86_400_000);
}

function parseChecklist(json: string): ChecklistItem[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const emptyForm: NewFilingForm = {
  action_type: 'small_claims',
  court_name: '',
  court_address: '',
  case_number: '',
  hearing_date: '',
  hearing_time: '',
  attorney_id: '',
  court_costs: '',
};

// ─── Component ──────────────────────────────────────────
const CourtFilingTracker: React.FC<CourtFilingTrackerProps> = ({ debtId }) => {
  const [actions, setActions] = useState<LegalAction[]>([]);
  const [attorneys, setAttorneys] = useState<Attorney[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<NewFilingForm>({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [newItemInputs, setNewItemInputs] = useState<Record<string, string>>({});

  // ── Load data ──
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [actionsData, contactsData] = await Promise.all([
          api.query('debt_legal_actions', { debt_id: debtId }),
          api.query('debt_contacts', { debt_id: debtId }),
        ]);
        if (cancelled) return;
        setActions(Array.isArray(actionsData) ? actionsData : []);
        const attyList = Array.isArray(contactsData)
          ? contactsData.filter((c: any) => c.role === 'attorney')
          : [];
        setAttorneys(attyList);
      } catch (err) {
        console.error('Failed to load legal actions:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [debtId, refreshKey]);

  const handleFormChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const { name, value } = e.target;
      setForm((prev) => ({ ...prev, [name]: value }));
    },
    []
  );

  // ── Create filing ──
  const handleCreateFiling = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const checklist = getDefaultChecklist(form.action_type);
      await api.create('debt_legal_actions', {
        debt_id: debtId,
        action_type: form.action_type,
        status: 'preparing',
        court_name: form.court_name || null,
        court_address: form.court_address || null,
        case_number: form.case_number || null,
        hearing_date: form.hearing_date || null,
        hearing_time: form.hearing_time || null,
        attorney_id: form.attorney_id || null,
        court_costs: form.court_costs ? Number(form.court_costs) : 0,
        checklist_json: JSON.stringify(checklist),
      });
      setShowForm(false);
      setForm({ ...emptyForm });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      console.error('Failed to create filing:', err);
    } finally {
      setSaving(false);
    }
  }, [debtId, form, saving]);

  // ── Toggle checklist item ──
  const handleToggleChecklistItem = useCallback(
    async (action: LegalAction, itemIdx: number) => {
      const items = parseChecklist(action.checklist_json);
      if (!items[itemIdx]) return;
      items[itemIdx].completed = !items[itemIdx].completed;
      items[itemIdx].completed_date = items[itemIdx].completed ? todayISO() : null;
      try {
        await api.update('debt_legal_actions', action.id, {
          checklist_json: JSON.stringify(items),
        });
        setRefreshKey((k) => k + 1);
      } catch (err) {
        console.error('Failed to update checklist:', err);
      }
    },
    []
  );

  // ── Add checklist item ──
  const handleAddChecklistItem = useCallback(
    async (action: LegalAction) => {
      const text = (newItemInputs[action.id] || '').trim();
      if (!text) return;
      const items = parseChecklist(action.checklist_json);
      items.push({ title: text, completed: false, completed_date: null, notes: '' });
      try {
        await api.update('debt_legal_actions', action.id, {
          checklist_json: JSON.stringify(items),
        });
        setNewItemInputs((prev) => ({ ...prev, [action.id]: '' }));
        setRefreshKey((k) => k + 1);
      } catch (err) {
        console.error('Failed to add checklist item:', err);
      }
    },
    [newItemInputs]
  );

  // ── Change filing status ──
  const handleStatusChange = useCallback(
    async (actionId: string, newStatus: string) => {
      try {
        await api.update('debt_legal_actions', actionId, { status: newStatus });
        setRefreshKey((k) => k + 1);
      } catch (err) {
        console.error('Failed to update filing status:', err);
      }
    },
    []
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-text-muted text-sm">
        Loading court filings...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-text-primary uppercase tracking-wider">
          Court Filings
        </h4>
        <button
          className="block-btn flex items-center gap-1.5 text-xs"
          onClick={() => setShowForm(!showForm)}
        >
          <Plus size={14} />
          New Filing
        </button>
      </div>

      {/* New Filing Form */}
      {showForm && (
        <form onSubmit={handleCreateFiling} className="block-card space-y-4">
          <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
            New Legal Action
          </h4>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Action Type
              </label>
              <select
                name="action_type"
                className="block-select"
                value={form.action_type}
                onChange={handleFormChange}
              >
                {ACTION_TYPES.map((at) => (
                  <option key={at.value} value={at.value}>{at.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Case Number
              </label>
              <input
                type="text"
                name="case_number"
                className="block-input"
                placeholder="e.g. CV-2026-001"
                value={form.case_number}
                onChange={handleFormChange}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Court Name
              </label>
              <input
                type="text"
                name="court_name"
                className="block-input"
                placeholder="Court name"
                value={form.court_name}
                onChange={handleFormChange}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Court Address
              </label>
              <input
                type="text"
                name="court_address"
                className="block-input"
                placeholder="Court address"
                value={form.court_address}
                onChange={handleFormChange}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Hearing Date
              </label>
              <input
                type="date"
                name="hearing_date"
                className="block-input"
                value={form.hearing_date}
                onChange={handleFormChange}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Hearing Time
              </label>
              <input
                type="text"
                name="hearing_time"
                className="block-input"
                placeholder="e.g. 9:00 AM"
                value={form.hearing_time}
                onChange={handleFormChange}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Court Costs
              </label>
              <input
                type="number"
                name="court_costs"
                className="block-input"
                placeholder="0.00"
                step="0.01"
                min="0"
                value={form.court_costs}
                onChange={handleFormChange}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              Attorney
            </label>
            <select
              name="attorney_id"
              className="block-select"
              value={form.attorney_id}
              onChange={handleFormChange}
            >
              <option value="">-- None --</option>
              {[...attorneys]
                .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }))
                .map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-border-primary">
            <button
              type="button"
              className="block-btn"
              onClick={() => { setShowForm(false); setForm({ ...emptyForm }); }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="block-btn-primary"
              disabled={saving}
            >
              {saving ? 'Creating...' : 'Create Filing'}
            </button>
          </div>
        </form>
      )}

      {/* Empty state */}
      {actions.length === 0 && !showForm && (
        <div className="block-card text-center py-12">
          <Gavel size={32} className="mx-auto text-text-muted mb-3" />
          <p className="text-text-muted text-sm">
            No legal actions filed. Create one to start tracking.
          </p>
        </div>
      )}

      {/* Filing cards */}
      {actions.map((action) => {
        const items = parseChecklist(action.checklist_json);
        const completedCount = items.filter((i) => i.completed).length;
        const totalCount = items.length;
        const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

        const typeInfo = formatStatus(action.action_type);
        const statusInfo = formatStatus(action.status);

        const days = daysUntil(action.hearing_date);
        const isPast = days !== null && days < 0;

        return (
          <div key={action.id} className="block-card space-y-3">
            {/* Header row */}
            <div className="flex items-center flex-wrap gap-2">
              <span className={typeInfo.className}>{typeInfo.label}</span>
              <span className={statusInfo.className}>{statusInfo.label}</span>
              {action.case_number && (
                <span className="text-xs text-text-secondary font-mono">
                  {action.case_number}
                </span>
              )}
            </div>

            {/* Court & Hearing info */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              {action.court_name && (
                <div>
                  <span className="text-text-muted">Court:</span>{' '}
                  <span className="text-text-secondary">{action.court_name}</span>
                </div>
              )}
              {action.hearing_date && (
                <div className="flex items-center gap-1.5">
                  <Clock size={12} className="text-text-muted" />
                  <span className="text-text-muted">Hearing:</span>{' '}
                  <span className="text-text-secondary">
                    {formatDate(action.hearing_date)}
                    {action.hearing_time ? ` at ${action.hearing_time}` : ''}
                  </span>
                  {days !== null && (
                    <span
                      className={`font-bold ml-1 ${
                        isPast
                          ? 'text-red-400'
                          : days <= 7
                            ? 'text-amber-400'
                            : 'text-text-secondary'
                      }`}
                    >
                      {isPast ? 'PAST' : `${days}d away`}
                    </span>
                  )}
                </div>
              )}
              {action.court_costs > 0 && (
                <div>
                  <span className="text-text-muted">Costs:</span>{' '}
                  <span className="text-text-secondary font-mono">
                    {formatCurrency(action.court_costs)}
                  </span>
                </div>
              )}
            </div>

            {/* Status selector */}
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
                Status
              </label>
              <select
                className="block-select text-xs"
                value={action.status}
                onChange={(e) => handleStatusChange(action.id, e.target.value)}
              >
                {STATUS_OPTIONS.map((s) => {
                  const si = formatStatus(s);
                  return <option key={s} value={s}>{si.label}</option>;
                })}
              </select>
            </div>

            {/* Progress bar */}
            {totalCount > 0 && (
              <div>
                <div className="flex items-center justify-between text-xs text-text-muted mb-1">
                  <span>Progress</span>
                  <span>{completedCount}/{totalCount} ({progressPct}%)</span>
                </div>
                <div
                  className="w-full h-2 bg-bg-tertiary overflow-hidden"
                  style={{ borderRadius: '6px' }}
                >
                  <div
                    className="h-full bg-emerald-500 transition-all"
                    style={{ width: `${progressPct}%`, borderRadius: '6px' }}
                  />
                </div>
              </div>
            )}

            {/* Checklist */}
            {totalCount > 0 && (
              <div className="space-y-1">
                {items.map((item, idx) => (
                  <label
                    key={idx}
                    className="flex items-center gap-2 px-2 py-1.5 hover:bg-bg-hover cursor-pointer text-xs transition-colors"
                    style={{ borderRadius: '6px' }}
                  >
                    <input
                      type="checkbox"
                      checked={item.completed}
                      onChange={() => handleToggleChecklistItem(action, idx)}
                      className="accent-emerald-500"
                    />
                    <span
                      className={`${
                        item.completed
                          ? 'text-text-muted line-through'
                          : 'text-text-secondary'
                      }`}
                    >
                      {item.title}
                    </span>
                    {item.completed && item.completed_date && (
                      <span className="text-[10px] text-text-muted ml-auto">
                        {formatDate(item.completed_date, { style: 'short' })}
                      </span>
                    )}
                  </label>
                ))}

                {/* Add checklist item */}
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="text"
                    className="block-input text-xs flex-1"
                    placeholder="Add checklist item..."
                    value={newItemInputs[action.id] || ''}
                    onChange={(e) =>
                      setNewItemInputs((prev) => ({
                        ...prev,
                        [action.id]: e.target.value,
                      }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddChecklistItem(action);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="block-btn p-1.5"
                    onClick={() => handleAddChecklistItem(action)}
                    title="Add Item"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default CourtFilingTracker;
