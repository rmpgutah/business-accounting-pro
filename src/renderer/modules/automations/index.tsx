import React, { useState, useEffect } from 'react';
import { Zap, ToggleLeft, ToggleRight, Clock } from 'lucide-react';
import api from '../../lib/api';
import { formatDate } from '../../lib/format';

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

// ─── Trigger Badge ───────────────────────────────────────
const TRIGGER_BADGE: Record<string, { border: string; text: string }> = {
  invoice_overdue: { border: 'border-orange-500', text: 'text-accent-warning' },
  bill_due_soon: { border: 'border-yellow-400', text: 'text-yellow-700' },
  payment_received: { border: 'border-green-500', text: 'text-green-700' },
  schedule: { border: 'border-blue-500', text: 'text-blue-700' },
};

function TriggerBadge({ type }: { type: string }) {
  const style = TRIGGER_BADGE[type] ?? { border: 'border-border-secondary', text: 'text-text-secondary' };
  return (
    <span
      className={`inline-block border-2 ${style.border} ${style.text} text-xs font-black uppercase tracking-wider px-2 py-0.5`}
    >
      {type.replace(/_/g, ' ')}
    </span>
  );
}

// ─── Status Badge ────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PASS: 'bg-green-100 text-green-800 border border-green-400',
    FAIL: 'bg-red-100 text-red-800 border border-red-400',
    SKIP: 'bg-bg-tertiary text-text-secondary border border-border-secondary',
  };
  const cls = map[status] ?? 'bg-bg-tertiary text-text-secondary border border-border-secondary';
  return (
    <span className={`inline-block text-xs font-black uppercase tracking-wider px-2 py-0.5 ${cls}`}>
      {status}
    </span>
  );
}

// ─── Pretty JSON block ───────────────────────────────────
function CodeBlock({ value }: { value: string | null }) {
  if (!value) return <span className="text-xs text-text-muted italic">None</span>;
  let parsed: any;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = value;
  }
  return (
    <pre className="bg-bg-tertiary border border-border-secondary p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
      {typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2)}
    </pre>
  );
}

// ─── Main Component ──────────────────────────────────────
const AutomationsModule: React.FC = () => {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [selected, setSelected] = useState<AutomationRule | null>(null);
  const [runLog, setRunLog] = useState<RunLogEntry[]>([]);
  const [loadingLog, setLoadingLog] = useState(false);

  const loadRules = async () => {
    try {
      const data = await api.listAutomations();
      setRules(data ?? []);
    } catch (err) {
      console.error('Failed to load automations:', err);
    }
  };

  useEffect(() => {
    loadRules();
  }, []);

  const handleSelect = async (rule: AutomationRule) => {
    setSelected(rule);
    setRunLog([]);
    setLoadingLog(true);
    try {
      const log = await api.automationRunLog(rule.id);
      setRunLog(log ?? []);
    } catch (err) {
      console.error('Failed to load run log:', err);
    } finally {
      setLoadingLog(false);
    }
  };

  const handleToggle = async (rule: AutomationRule, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.toggleAutomation(rule.id);
      await loadRules();
      // If we just toggled the selected rule, refresh its data too
      if (selected?.id === rule.id) {
        setSelected((prev) =>
          prev ? { ...prev, is_active: prev.is_active === 1 ? 0 : 1 } : null
        );
      }
    } catch (err) {
      console.error('Failed to toggle automation:', err);
    }
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left Panel: Rule List ── */}
      <div className="w-80 border-r-2 border-border-primary flex flex-col bg-bg-secondary">
        {/* Header */}
        <div className="border-b-2 border-border-primary p-5">
          <div className="flex items-center gap-2 mb-1">
            <Zap size={18} className="text-text-primary" strokeWidth={3} />
            <h1 className="text-base font-black uppercase tracking-wider text-text-primary">
              Automations
            </h1>
          </div>
          <p className="text-xs text-text-muted">Automated rules that run on your data</p>
        </div>

        {/* Rule List */}
        <div className="flex-1 overflow-y-auto">
          {rules.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-sm text-text-muted italic">No automation rules configured.</p>
            </div>
          ) : (
            rules.map((rule) => {
              const isSelected = selected?.id === rule.id;
              return (
                <div
                  key={rule.id}
                  onClick={() => handleSelect(rule)}
                  className={`border-b-2 border-border-primary p-4 cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-bg-primary text-white'
                      : 'hover:bg-bg-secondary'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-sm font-black leading-tight truncate ${
                          isSelected ? 'text-white' : 'text-text-primary'
                        }`}
                      >
                        {rule.name}
                      </p>
                      <div className="mt-1">
                        <TriggerBadge type={rule.trigger_type} />
                      </div>
                      <div className="flex items-center gap-1 mt-2">
                        <Clock size={11} className={isSelected ? 'text-text-muted' : 'text-text-muted'} />
                        <span className={`text-xs ${isSelected ? 'text-text-muted' : 'text-text-muted'}`}>
                          {rule.last_run_at
                            ? formatDate(rule.last_run_at)
                            : 'Never'}
                        </span>
                      </div>
                    </div>
                    {/* Active toggle */}
                    <button
                      onClick={(e) => handleToggle(rule, e)}
                      className="flex-shrink-0 mt-0.5"
                      title={rule.is_active ? 'Deactivate' : 'Activate'}
                    >
                      {rule.is_active ? (
                        <ToggleRight
                          size={22}
                          className={isSelected ? 'text-green-400' : 'text-accent-income'}
                          strokeWidth={2}
                        />
                      ) : (
                        <ToggleLeft
                          size={22}
                          className={isSelected ? 'text-text-muted' : 'text-text-muted'}
                          strokeWidth={2}
                        />
                      )}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Right Panel: Rule Detail ── */}
      <div className="flex-1 overflow-y-auto bg-bg-secondary">
        {!selected ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center border-2 border-border-secondary p-10 bg-bg-secondary">
              <Zap size={36} className="text-text-muted mx-auto mb-3" strokeWidth={1.5} />
              <p className="text-sm font-black uppercase tracking-wider text-text-muted">
                Select a rule to view details
              </p>
            </div>
          </div>
        ) : (
          <div className="p-6 space-y-6 max-w-3xl">
            {/* Rule name + status */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-black text-text-primary uppercase tracking-wide">
                  {selected.name}
                </h2>
                <div className="mt-2 flex items-center gap-3">
                  <TriggerBadge type={selected.trigger_type} />
                  <span
                    className={`text-xs font-black uppercase tracking-wider px-2 py-0.5 border-2 ${
                      selected.is_active
                        ? 'border-green-500 text-green-700'
                        : 'border-border-secondary text-text-muted'
                    }`}
                  >
                    {selected.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            </div>

            {/* Trigger */}
            <div className="border-2 border-border-primary bg-bg-secondary p-4">
              <p className="text-xs font-black uppercase tracking-wider text-text-muted mb-3">
                Trigger
              </p>
              <p className="text-sm font-bold text-text-primary mb-2 uppercase tracking-wide">
                {selected.trigger_type.replace(/_/g, ' ')}
              </p>
              <CodeBlock value={selected.trigger_config} />
            </div>

            {/* Conditions */}
            <div className="border-2 border-border-primary bg-bg-secondary p-4">
              <p className="text-xs font-black uppercase tracking-wider text-text-muted mb-3">
                Conditions
              </p>
              <CodeBlock value={selected.conditions} />
            </div>

            {/* Actions */}
            <div className="border-2 border-border-primary bg-bg-secondary p-4">
              <p className="text-xs font-black uppercase tracking-wider text-text-muted mb-3">
                Actions
              </p>
              <CodeBlock value={selected.actions} />
            </div>

            {/* Run Log */}
            <div className="border-2 border-border-primary bg-bg-secondary">
              <div className="border-b-2 border-border-primary px-4 py-3">
                <p className="text-xs font-black uppercase tracking-wider text-text-muted">
                  Run Log
                </p>
              </div>
              {loadingLog ? (
                <div className="p-4 text-sm text-text-muted italic">Loading...</div>
              ) : runLog.length === 0 ? (
                <div className="p-4 text-sm text-text-muted italic">No runs recorded yet</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2 border-border-primary">
                      <th className="text-left text-xs font-black uppercase tracking-wider text-text-muted px-4 py-2">
                        Date
                      </th>
                      <th className="text-left text-xs font-black uppercase tracking-wider text-text-muted px-4 py-2">
                        Status
                      </th>
                      <th className="text-left text-xs font-black uppercase tracking-wider text-text-muted px-4 py-2">
                        Detail
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {runLog.map((entry) => (
                      <tr key={entry.id} className="border-b border-border-primary">
                        <td className="px-4 py-2 text-xs font-mono text-text-secondary whitespace-nowrap">
                          {formatDate(entry.ran_at)}
                        </td>
                        <td className="px-4 py-2">
                          <StatusBadge status={entry.status} />
                        </td>
                        <td className="px-4 py-2 text-xs text-text-secondary">
                          {entry.detail ?? '—'}
                        </td>
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
  );
};

export default AutomationsModule;
