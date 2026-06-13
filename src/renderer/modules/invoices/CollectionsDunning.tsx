import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Clock,
  Eye,
  List,
  Play,
  Plus,
  RefreshCw,
  Shield,
  Zap,
} from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CollectionBoardRow {
  id: string;
  invoice_id: string;
  invoice_number: string;
  total: number;
  amount_paid: number;
  due_date: string;
  client_name: string;
  score: number;
  risk_level: 'low' | 'medium' | 'high';
  factors_json: string;
}

interface DunningPreview {
  error?: string;
  invoices?: Array<{
    invoice_id: string;
    invoice_number?: string;
    client_name?: string;
    days_overdue?: number;
    current_stage?: number;
    next_stage?: number;
    action?: string;
  }>;
  [key: string]: any;
}

interface DunningSequence {
  id: string;
  sequence_name: string;
  steps_json: string;
  is_active: number;
  created_at: string;
}

interface DunningStep {
  offset_days: number;
  method: string;
  template: string;
}

// ─── Sub-tab button ──────────────────────────────────────────────────────────

const SubTabBtn: React.FC<{ active: boolean; label: string; onClick: () => void }> = ({
  active,
  label,
  onClick,
}) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 text-xs font-semibold transition-colors rounded-t ${
      active
        ? 'text-text-primary border-b-2 border-accent-primary'
        : 'text-text-muted hover:text-text-secondary'
    }`}
  >
    {label}
  </button>
);

// ─── Risk badge ──────────────────────────────────────────────────────────────

const RiskBadge: React.FC<{ risk: string }> = ({ risk }) => {
  const token =
    risk === 'high' ? 'var(--color-accent-expense)'
    : risk === 'low' ? 'var(--color-accent-income)'
    : 'var(--color-accent-warning)';
  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
      style={{
        color: token,
        background: `color-mix(in srgb, ${token} 18%, transparent)`,
        border: `1px solid color-mix(in srgb, ${token} 40%, transparent)`,
      }}
    >
      {risk}
    </span>
  );
};

// ─── Collection Board panel ──────────────────────────────────────────────────

const CollectionBoard: React.FC = () => {
  const [rows, setRows] = useState<CollectionBoardRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const load = useCallback(async () => {
    cancelledRef.current = false;
    setLoading(true);
    try {
      const result = await api.ivCollectionBoard();
      if (cancelledRef.current) return;
      const arr = Array.isArray(result) ? result : [];
      setRows(
        arr.map((r: any) => ({
          id: r.id ?? '',
          invoice_id: r.invoice_id ?? '',
          invoice_number: r.invoice_number ?? '--',
          total: Number(r.total) || 0,
          amount_paid: Number(r.amount_paid) || 0,
          due_date: r.due_date ?? '',
          client_name: r.client_name ?? '--',
          score: Number(r.score) || 0,
          risk_level: (r.risk_level as 'low' | 'medium' | 'high') ?? 'medium',
          factors_json: r.factors_json ?? '[]',
        }))
      );
    } catch (err) {
      console.error('collectionBoard load error:', err);
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, []);

  const recompute = useCallback(async () => {
    setRecomputing(true);
    try {
      await api.ivCollectionScoresBulk();
      await load();
    } finally {
      setRecomputing(false);
    }
  }, [load]);

  useEffect(() => {
    load();
    return () => { cancelledRef.current = true; };
  }, [load]);

  const balance = (r: CollectionBoardRow) => r.total - r.amount_paid;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="text-text-muted text-sm">Loading collection board…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-text-primary">Collection Board</h3>
          <p className="text-xs text-text-muted">
            Overdue invoices ranked by collection risk score (lower = harder to collect).
          </p>
        </div>
        <button
          className="block-btn flex items-center gap-2 text-xs"
          onClick={recompute}
          disabled={recomputing}
        >
          <RefreshCw size={13} className={recomputing ? 'animate-spin' : ''} />
          {recomputing ? 'Recomputing…' : 'Recompute Scores'}
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="block-card p-8 text-center text-sm text-text-muted">
          No overdue invoices in the collection board. All caught up!
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden">
          <table className="block-table">
            <thead>
              <tr>
                <th style={{ width: 24 }} />
                <th>Invoice</th>
                <th>Client</th>
                <th>Due Date</th>
                <th className="text-right">Balance</th>
                <th className="text-center">Score</th>
                <th className="text-center">Risk</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const expanded = expandedRow === r.id;
                let factors: string[] = [];
                try { factors = JSON.parse(r.factors_json); } catch { /* ignore */ }
                const scoreColor =
                  r.risk_level === 'high'
                    ? 'var(--color-accent-expense)'
                    : r.risk_level === 'medium'
                    ? 'var(--color-accent-warning)'
                    : 'var(--color-accent-income)';
                return (
                  <React.Fragment key={r.id}>
                    <tr
                      className="cursor-pointer"
                      onClick={() => setExpandedRow(expanded ? null : r.id)}
                    >
                      <td>
                        <span className="text-text-muted">
                          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        </span>
                      </td>
                      <td className="font-mono text-xs text-accent-blue">{r.invoice_number}</td>
                      <td className="text-text-primary">{r.client_name}</td>
                      <td className="text-text-secondary text-xs">
                        {r.due_date ? formatDate(r.due_date) : '--'}
                      </td>
                      <td
                        className="text-right font-mono font-semibold"
                        style={{ color: 'var(--color-accent-expense)' }}
                      >
                        {formatCurrency(balance(r))}
                      </td>
                      <td className="text-center">
                        <span className="font-mono font-bold text-sm" style={{ color: scoreColor }}>
                          {r.score}
                        </span>
                      </td>
                      <td className="text-center">
                        <RiskBadge risk={r.risk_level} />
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={7} className="px-6 py-3 bg-bg-tertiary/40">
                          <div className="text-xs text-text-secondary space-y-1">
                            <div className="font-semibold text-text-muted uppercase tracking-wider mb-1">
                              Score Factors
                            </div>
                            {factors.length === 0 ? (
                              <span className="text-text-muted">No factors computed.</span>
                            ) : (
                              factors.map((f, i) => (
                                <div key={i} className="flex items-center gap-2">
                                  <Shield size={11} className="text-text-muted flex-shrink-0" />
                                  {f}
                                </div>
                              ))
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ─── Dunning Sequences panel ─────────────────────────────────────────────────

const DunningSequences: React.FC = () => {
  const [sequences, setSequences] = useState<DunningSequence[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [preview, setPreview] = useState<DunningPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  // New sequence form state
  const [seqName, setSeqName] = useState('');
  const [steps, setSteps] = useState<DunningStep[]>([
    { offset_days: 7, method: 'email', template: 'First Reminder' },
    { offset_days: 14, method: 'email', template: 'Second Reminder' },
    { offset_days: 30, method: 'email', template: 'Final Notice' },
  ]);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    cancelledRef.current = false;
    setLoading(true);
    try {
      const result = await api.dunningSeqList();
      if (cancelledRef.current) return;
      const arr = Array.isArray(result) ? result : [];
      setSequences(arr);
    } catch (err) {
      console.error('dunningSeqList error:', err);
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    return () => { cancelledRef.current = true; };
  }, [load]);

  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreview(null);
    try {
      const result = await api.dunningPreview();
      setPreview(result ?? { invoices: [] });
    } catch (err) {
      setPreview({ error: String(err) });
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const handleRun = useCallback(async () => {
    const ok = window.confirm(
      'Run auto-dunning now? This will advance dunning stages and queue reminders for all eligible overdue invoices.'
    );
    if (!ok) return;
    setRunLoading(true);
    setRunResult(null);
    try {
      const result = await api.dunningRun();
      if (result?.errors?.length) {
        setRunResult(`Error: ${result.errors[0]}`);
      } else {
        const processed = result?.invoicesProcessed ?? 0;
        const reminders = result?.remindersQueued ?? 0;
        const suggested = result?.collectionsSuggested ?? 0;
        setRunResult(
          `Done — ${processed} invoice(s) processed, ${reminders} reminder(s) queued, ${suggested} collection(s) suggested.`
        );
      }
    } catch (err) {
      setRunResult(`Error: ${String(err)}`);
    } finally {
      setRunLoading(false);
    }
  }, []);

  const addStep = () =>
    setSteps((s) => [...s, { offset_days: (s[s.length - 1]?.offset_days ?? 0) + 7, method: 'email', template: '' }]);

  const removeStep = (i: number) => setSteps((s) => s.filter((_, idx) => idx !== i));

  const updateStep = (i: number, field: keyof DunningStep, value: string | number) =>
    setSteps((s) => s.map((st, idx) => (idx === i ? { ...st, [field]: value } : st)));

  const handleCreate = async () => {
    if (!seqName.trim()) { alert('Sequence name is required.'); return; }
    if (steps.length === 0) { alert('Add at least one step.'); return; }
    setCreating(true);
    try {
      await api.featDunningSeqCreate({ sequence_name: seqName.trim(), steps });
      setSeqName('');
      setSteps([
        { offset_days: 7, method: 'email', template: 'First Reminder' },
        { offset_days: 14, method: 'email', template: 'Second Reminder' },
        { offset_days: 30, method: 'email', template: 'Final Notice' },
      ]);
      setShowForm(false);
      await load();
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div>
          <h3 className="text-base font-bold text-text-primary">Dunning Sequences</h3>
          <p className="text-xs text-text-muted">
            Build multi-step AR collection sequences and run dunning automation.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="block-btn flex items-center gap-2 text-xs"
            onClick={loadPreview}
            disabled={previewLoading}
          >
            <Eye size={13} />
            {previewLoading ? 'Loading…' : 'Preview Dunning'}
          </button>
          <button
            className="block-btn flex items-center gap-2 text-xs"
            onClick={handleRun}
            disabled={runLoading}
            style={{ borderColor: 'var(--color-accent-warning)', color: 'var(--color-accent-warning)' }}
          >
            <Play size={13} />
            {runLoading ? 'Running…' : 'Run Dunning Now'}
          </button>
          <button
            className="block-btn-primary flex items-center gap-2 text-xs"
            onClick={() => setShowForm((v) => !v)}
          >
            <Plus size={13} /> New Sequence
          </button>
        </div>
      </div>

      {/* Run result */}
      {runResult && (
        <div
          className="px-4 py-3 text-sm rounded"
          style={{
            background: 'color-mix(in srgb, var(--color-accent-warning) 10%, transparent)',
            border: '1px solid var(--color-accent-warning)',
            color: 'var(--color-accent-warning)',
          }}
        >
          <Zap size={13} className="inline mr-2" />
          {runResult}
        </div>
      )}

      {/* Preview panel */}
      {preview && (
        <div className="block-card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-border-primary flex items-center gap-2">
            <Eye size={13} className="text-text-muted" />
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
              Dunning Preview
            </span>
          </div>
          {preview.error ? (
            <div className="p-4 text-sm" style={{ color: 'var(--color-accent-expense)' }}>
              {preview.error}
            </div>
          ) : Array.isArray(preview.invoices) && preview.invoices.length === 0 ? (
            <div className="p-6 text-center text-sm text-text-muted">
              No invoices would be actioned by dunning right now.
            </div>
          ) : Array.isArray(preview.invoices) ? (
            <table className="block-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Client</th>
                  <th className="text-right">Days Overdue</th>
                  <th className="text-center">Stage</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {preview.invoices.map((inv: any, i: number) => (
                  <tr key={i}>
                    <td className="font-mono text-xs text-accent-blue">
                      {inv.invoice_number ?? inv.invoice_id ?? '--'}
                    </td>
                    <td className="text-text-secondary">{inv.client_name ?? '--'}</td>
                    <td className="text-right font-mono text-sm" style={{ color: 'var(--color-accent-expense)' }}>
                      {inv.days_overdue ?? '--'}
                    </td>
                    <td className="text-center text-text-muted text-xs">
                      {inv.current_stage ?? '--'} → {inv.next_stage ?? '--'}
                    </td>
                    <td className="text-text-secondary text-xs">{inv.action ?? '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <pre className="p-4 text-xs text-text-secondary overflow-auto">
              {JSON.stringify(preview, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* New Sequence form */}
      {showForm && (
        <div className="block-card p-5 space-y-4">
          <h4 className="text-sm font-bold text-text-primary">New Dunning Sequence</h4>

          <div>
            <label className="block text-xs font-semibold text-text-muted mb-1">
              Sequence Name <span style={{ color: 'var(--color-accent-expense)' }}>*</span>
            </label>
            <input
              className="block-input w-full"
              placeholder="e.g. Standard AR Collections"
              value={seqName}
              onChange={(e) => setSeqName(e.target.value)}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Steps</span>
              <button className="block-btn text-xs flex items-center gap-1" onClick={addStep}>
                <Plus size={11} /> Add Step
              </button>
            </div>
            <div className="space-y-2">
              {steps.map((st, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[10px] text-text-muted w-5 text-right flex-shrink-0">
                    {i + 1}.
                  </span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      className="block-input w-16 text-right text-xs"
                      value={st.offset_days}
                      min={1}
                      onChange={(e) => updateStep(i, 'offset_days', Number(e.target.value))}
                    />
                    <span className="text-xs text-text-muted">days after due</span>
                  </div>
                  <select
                    className="block-input text-xs flex-shrink-0"
                    value={st.method}
                    onChange={(e) => updateStep(i, 'method', e.target.value)}
                  >
                    <option value="email">Email</option>
                    <option value="phone">Phone Call</option>
                    <option value="letter">Letter</option>
                    <option value="sms">SMS</option>
                  </select>
                  <input
                    className="block-input flex-1 text-xs"
                    placeholder="Template name / subject"
                    value={st.template}
                    onChange={(e) => updateStep(i, 'template', e.target.value)}
                  />
                  <button
                    className="text-text-muted hover:text-accent-expense text-xs px-1"
                    onClick={() => removeStep(i)}
                    style={{ color: 'var(--color-accent-expense)' }}
                    title="Remove step"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {steps.length === 0 && (
                <div className="text-xs text-text-muted py-2">No steps yet. Click "Add Step".</div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              className="block-btn-primary text-xs"
              onClick={handleCreate}
              disabled={creating}
            >
              {creating ? 'Saving…' : 'Save Sequence'}
            </button>
            <button
              className="block-btn text-xs"
              onClick={() => setShowForm(false)}
              disabled={creating}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Sequence list */}
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <span className="text-text-muted text-sm">Loading sequences…</span>
        </div>
      ) : sequences.length === 0 ? (
        <div className="block-card p-8 text-center text-sm text-text-muted">
          No dunning sequences yet. Create one to automate AR collections.
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden">
          <table className="block-table">
            <thead>
              <tr>
                <th>Sequence Name</th>
                <th className="text-center">Steps</th>
                <th className="text-center">Active</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {sequences.map((s) => {
                let stepCount = 0;
                try { stepCount = JSON.parse(s.steps_json)?.length ?? 0; } catch { /* ignore */ }
                return (
                  <tr key={s.id}>
                    <td className="font-semibold text-text-primary">{s.sequence_name}</td>
                    <td className="text-center text-text-secondary font-mono">{stepCount}</td>
                    <td className="text-center">
                      <span
                        className="text-[10px] font-bold uppercase"
                        style={{ color: s.is_active ? 'var(--color-accent-income)' : undefined }}
                      >
                        {s.is_active ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td className="text-text-muted text-xs">
                      {s.created_at ? formatDate(s.created_at) : '--'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ─── Main export ─────────────────────────────────────────────────────────────

type SubTab = 'board' | 'sequences';

const CollectionsDunning: React.FC = () => {
  const [subTab, setSubTab] = useState<SubTab>('board');

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <AlertTriangle size={18} style={{ color: 'var(--color-accent-expense)' }} />
        <div>
          <h2 className="text-lg font-bold text-text-primary">Collections &amp; Dunning</h2>
          <p className="text-xs text-text-muted">
            AR collection board, risk scores, and automated dunning sequences.
          </p>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 border-b border-border-primary">
        <SubTabBtn
          active={subTab === 'board'}
          label="Collection Board"
          onClick={() => setSubTab('board')}
        />
        <SubTabBtn
          active={subTab === 'sequences'}
          label="Dunning Sequences"
          onClick={() => setSubTab('sequences')}
        />
      </div>

      {subTab === 'board' && <CollectionBoard />}
      {subTab === 'sequences' && <DunningSequences />}
    </div>
  );
};

export default CollectionsDunning;
