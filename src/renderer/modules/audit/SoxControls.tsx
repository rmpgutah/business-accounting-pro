import React, { useEffect, useState, useCallback } from 'react';
import { ShieldCheck, Plus, ChevronDown, ChevronRight, AlertTriangle, CheckCircle, XCircle, User } from 'lucide-react';
import api from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useCompanyStore } from '../../stores/companyStore';
import ErrorBanner from '../../components/ErrorBanner';

// ─── Types ────────────────────────────────────────────────
interface SoxControl {
  id: string;
  code: string;
  description: string;
  owner: string;
  frequency: string;
  risk: string;
  last_result?: string;
  last_tested_at?: string;
  test_count?: number;
}

interface SoxTest {
  id: string;
  control_id: string;
  tested_by: string;
  tested_at: string;
  result: string;
  evidence: string;
  notes: string;
}

interface SodConflict {
  id: string;
  conflicting_function_a: string;
  conflicting_function_b: string;
  risk_level: string;
  mitigation_required?: string;
  is_active: number;
}

interface SodCheckResult {
  user_id: string;
  assigned_functions: string[];
  conflicts: SodConflict[];
}

// ─── Helpers ──────────────────────────────────────────────
const RISK_BADGE: Record<string, string> = {
  high: 'block-badge block-badge-expense',
  medium: 'block-badge block-badge-warning',
  low: 'block-badge block-badge-income',
};

const RESULT_BADGE: Record<string, string> = {
  pass: 'block-badge block-badge-income',
  fail: 'block-badge block-badge-expense',
  exception: 'block-badge block-badge-warning',
};

// ─── Control Form ─────────────────────────────────────────
interface ControlFormProps {
  companyId: string;
  initial?: Partial<SoxControl>;
  onSaved: () => void;
  onCancel: () => void;
}

const ControlForm: React.FC<ControlFormProps> = ({ companyId, initial, onSaved, onCancel }) => {
  const [code, setCode] = useState(initial?.code ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [owner, setOwner] = useState(initial?.owner ?? '');
  const [frequency, setFrequency] = useState(initial?.frequency ?? 'quarterly');
  const [risk, setRisk] = useState(initial?.risk ?? 'medium');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!code.trim() || !description.trim()) { setError('Code and description are required.'); return; }
    setSaving(true);
    try {
      const res = await api.soxControlSave({ id: initial?.id, companyId, code: code.trim(), description: description.trim(), owner, frequency, risk });
      if (res?.error) throw new Error(res.error);
      onSaved();
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="block-card p-4 space-y-3">
      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-text-muted mb-1">Control Code *</label>
          <input className="block-input" value={code} onChange={e => setCode(e.target.value)} placeholder="e.g. SOX-AP-01" />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Owner</label>
          <input className="block-input" value={owner} onChange={e => setOwner(e.target.value)} placeholder="Name or role" />
        </div>
      </div>
      <div>
        <label className="block text-xs text-text-muted mb-1">Description *</label>
        <textarea className="block-input min-h-[60px]" value={description} onChange={e => setDescription(e.target.value)} placeholder="What this control does..." />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-text-muted mb-1">Frequency</label>
          <select className="block-select" value={frequency} onChange={e => setFrequency(e.target.value)}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annually">Annually</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Risk Level</label>
          <select className="block-select" value={risk} onChange={e => setRisk(e.target.value)}>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button className="block-btn block-btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="block-btn block-btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : initial?.id ? 'Update Control' : 'Add Control'}
        </button>
      </div>
    </div>
  );
};

// ─── Test Form ────────────────────────────────────────────
interface TestFormProps {
  companyId: string;
  controlId: string;
  onSaved: () => void;
  onCancel: () => void;
}

const TestForm: React.FC<TestFormProps> = ({ companyId, controlId, onSaved, onCancel }) => {
  const [testedBy, setTestedBy] = useState('');
  const [testedAt, setTestedAt] = useState(new Date().toISOString().split('T')[0]);
  const [result, setResult] = useState('pass');
  const [evidence, setEvidence] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.soxTestSave({ controlId, companyId, testedBy, testedAt, result, evidence, notes });
      if (res?.error) throw new Error(res.error);
      onSaved();
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="block-card p-4 space-y-3 border-l-2 border-accent-primary ml-4">
      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Record Test</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-text-muted mb-1">Tested By</label>
          <input className="block-input" value={testedBy} onChange={e => setTestedBy(e.target.value)} placeholder="Auditor name" />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Test Date</label>
          <input type="date" className="block-input" value={testedAt} onChange={e => setTestedAt(e.target.value)} />
        </div>
      </div>
      <div>
        <label className="block text-xs text-text-muted mb-1">Result</label>
        <select className="block-select" value={result} onChange={e => setResult(e.target.value)}>
          <option value="pass">Pass</option>
          <option value="fail">Fail</option>
          <option value="exception">Exception</option>
        </select>
      </div>
      <div>
        <label className="block text-xs text-text-muted mb-1">Evidence</label>
        <input className="block-input" value={evidence} onChange={e => setEvidence(e.target.value)} placeholder="Document reference or description" />
      </div>
      <div>
        <label className="block text-xs text-text-muted mb-1">Notes</label>
        <textarea className="block-input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional notes..." />
      </div>
      <div className="flex gap-2 justify-end">
        <button className="block-btn block-btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="block-btn block-btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Record Test'}</button>
      </div>
    </div>
  );
};

// ─── Control Row (expandable) ─────────────────────────────
interface ControlRowProps {
  control: SoxControl;
  companyId: string;
  onRefresh: () => void;
}

const ControlRow: React.FC<ControlRowProps> = ({ control, companyId, onRefresh }) => {
  const [expanded, setExpanded] = useState(false);
  const [tests, setTests] = useState<SoxTest[]>([]);
  const [loadingTests, setLoadingTests] = useState(false);
  const [testError, setTestError] = useState('');
  const [showTestForm, setShowTestForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [testsKey, setTestsKey] = useState(0);

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    setLoadingTests(true);
    setTestError('');
    api.soxTestsList(control.id)
      .then((rows: SoxTest[]) => { if (!cancelled) setTests(Array.isArray(rows) ? rows : []); })
      .catch((e: any) => { if (!cancelled) setTestError(e?.message || 'Failed to load tests'); })
      .finally(() => { if (!cancelled) setLoadingTests(false); });
    return () => { cancelled = true; };
  }, [expanded, control.id, testsKey]);

  const handleDelete = async () => {
    if (!window.confirm(`Delete control ${control.code}? This cannot be undone.`)) return;
    await api.soxControlDelete(control.id);
    onRefresh();
  };

  return (
    <div className="border-b border-border-primary last:border-0">
      <div
        className="flex items-center gap-3 px-4 py-3 hover:bg-bg-secondary cursor-pointer"
        onClick={() => setExpanded(e => !e)}
      >
        <span className="text-text-muted shrink-0">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className="font-mono text-xs text-text-muted w-24 shrink-0">{control.code}</span>
        <span className="flex-1 text-sm text-text-primary truncate">{control.description}</span>
        <span className="text-xs text-text-muted w-24 shrink-0">{control.owner || '—'}</span>
        <span className="text-xs text-text-muted w-20 shrink-0 capitalize">{control.frequency || '—'}</span>
        <span className={RISK_BADGE[control.risk] || 'block-badge'} onClick={e => e.stopPropagation()}>{control.risk || '—'}</span>
        {control.last_result && (
          <span className={RESULT_BADGE[control.last_result] || 'block-badge'} onClick={e => e.stopPropagation()}>
            {control.last_result}
          </span>
        )}
        <span className="text-xs text-text-muted shrink-0">{control.test_count ?? 0} tests</span>
        <button
          className="block-btn block-btn-ghost text-xs py-0.5 px-2 shrink-0"
          onClick={e => { e.stopPropagation(); setShowEditForm(v => !v); setExpanded(true); }}
        >Edit</button>
        <button
          className="block-btn block-btn-ghost text-xs py-0.5 px-2 text-accent-expense shrink-0"
          onClick={e => { e.stopPropagation(); handleDelete(); }}
        >Delete</button>
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {showEditForm && (
            <ControlForm
              companyId={companyId}
              initial={control}
              onSaved={() => { setShowEditForm(false); onRefresh(); }}
              onCancel={() => setShowEditForm(false)}
            />
          )}

          {testError && <ErrorBanner message={testError} onDismiss={() => setTestError('')} />}

          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Test History</p>
            <button className="block-btn block-btn-ghost text-xs" onClick={() => setShowTestForm(v => !v)}>
              <Plus size={12} className="inline mr-1" />{showTestForm ? 'Cancel' : 'Record Test'}
            </button>
          </div>

          {showTestForm && (
            <TestForm
              companyId={companyId}
              controlId={control.id}
              onSaved={() => { setShowTestForm(false); setTestsKey(k => k + 1); onRefresh(); }}
              onCancel={() => setShowTestForm(false)}
            />
          )}

          {loadingTests ? (
            <p className="text-xs text-text-muted">Loading tests...</p>
          ) : tests.length === 0 ? (
            <p className="text-xs text-text-muted italic">No tests recorded yet.</p>
          ) : (
            <table className="block-table text-xs">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Tested By</th>
                  <th>Result</th>
                  <th>Evidence</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {tests.map(t => (
                  <tr key={t.id}>
                    <td className="font-mono whitespace-nowrap">{t.tested_at ? formatDate(t.tested_at) : '—'}</td>
                    <td>{t.tested_by || '—'}</td>
                    <td><span className={RESULT_BADGE[t.result] || 'block-badge'}>{t.result}</span></td>
                    <td className="text-text-muted max-w-[200px] truncate" title={t.evidence}>{t.evidence || '—'}</td>
                    <td className="text-text-muted max-w-[200px] truncate" title={t.notes}>{t.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};

// ─── SoD Section ──────────────────────────────────────────
interface SodSectionProps {
  companyId: string;
}

const SodSection: React.FC<SodSectionProps> = ({ companyId }) => {
  const [conflicts, setConflicts] = useState<SodConflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [conflictsKey, setConflictsKey] = useState(0);

  // Declare form
  const [showDeclareForm, setShowDeclareForm] = useState(false);
  const [funcA, setFuncA] = useState('');
  const [funcB, setFuncB] = useState('');
  const [riskLevel, setRiskLevel] = useState('medium');
  const [mitigation, setMitigation] = useState('');
  const [declareError, setDeclareError] = useState('');
  const [declaring, setDeclaring] = useState(false);

  // Assign form
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [assignUserId, setAssignUserId] = useState('');
  const [assignFunc, setAssignFunc] = useState('');
  const [assignGrantedBy, setAssignGrantedBy] = useState('');
  const [assignError, setAssignError] = useState('');
  const [assigning, setAssigning] = useState(false);

  // Check form
  const [showCheckForm, setShowCheckForm] = useState(false);
  const [checkUserId, setCheckUserId] = useState('');
  const [checkResult, setCheckResult] = useState<SodCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.featSoDList()
      .then((rows: SodConflict[]) => { if (!cancelled) setConflicts(Array.isArray(rows) ? rows : []); })
      .catch((e: any) => { if (!cancelled) setError(e?.message || 'Failed to load SoD conflicts'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [conflictsKey]);

  const handleDeclare = async () => {
    if (!funcA.trim() || !funcB.trim()) { setDeclareError('Both function codes are required.'); return; }
    setDeclaring(true);
    try {
      const res = await api.featSoDDeclare({ conflicting_function_a: funcA.trim(), conflicting_function_b: funcB.trim(), risk_level: riskLevel, mitigation_required: mitigation || null });
      if (res?.error) throw new Error(res.error);
      setShowDeclareForm(false);
      setFuncA(''); setFuncB(''); setMitigation(''); setDeclareError('');
      setConflictsKey(k => k + 1);
    } catch (e: any) {
      setDeclareError(e?.message || 'Declare failed');
    } finally {
      setDeclaring(false);
    }
  };

  const handleAssign = async () => {
    if (!assignUserId.trim() || !assignFunc.trim()) { setAssignError('User ID and function code are required.'); return; }
    setAssigning(true);
    try {
      const res = await api.featSoDAssign({ user_id: assignUserId.trim(), function_code: assignFunc.trim(), granted_by: assignGrantedBy || null });
      if (res?.error) throw new Error(res.error);
      setShowAssignForm(false);
      setAssignUserId(''); setAssignFunc(''); setAssignGrantedBy(''); setAssignError('');
    } catch (e: any) {
      setAssignError(e?.message || 'Assign failed');
    } finally {
      setAssigning(false);
    }
  };

  const handleCheck = async () => {
    if (!checkUserId.trim()) { setCheckError('User ID is required.'); return; }
    setChecking(true);
    try {
      const res = await api.featSoDCheck(checkUserId.trim());
      if (res?.error) throw new Error(res.error);
      setCheckResult(res);
      setCheckError('');
    } catch (e: any) {
      setCheckError(e?.message || 'Check failed');
    } finally {
      setChecking(false);
    }
  };

  const RISK_LEVEL_BADGE: Record<string, string> = {
    high: 'block-badge block-badge-expense',
    medium: 'block-badge block-badge-warning',
    low: 'block-badge block-badge-income',
  };

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}

      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-text-primary">Segregation of Duties</p>
        <div className="flex gap-2">
          <button className="block-btn block-btn-ghost text-xs" onClick={() => setShowCheckForm(v => !v)}>
            <User size={12} className="inline mr-1" />Check User
          </button>
          <button className="block-btn block-btn-ghost text-xs" onClick={() => setShowAssignForm(v => !v)}>
            Assign Function
          </button>
          <button className="block-btn block-btn-primary text-xs" onClick={() => setShowDeclareForm(v => !v)}>
            <Plus size={12} className="inline mr-1" />Declare Conflict
          </button>
        </div>
      </div>

      {/* Declare Form */}
      {showDeclareForm && (
        <div className="block-card p-4 space-y-3">
          {declareError && <ErrorBanner message={declareError} onDismiss={() => setDeclareError('')} />}
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Declare SoD Rule</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">Function A *</label>
              <input className="block-input" value={funcA} onChange={e => setFuncA(e.target.value)} placeholder="e.g. AP_APPROVE" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Function B *</label>
              <input className="block-input" value={funcB} onChange={e => setFuncB(e.target.value)} placeholder="e.g. AP_PAY" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">Risk Level</label>
              <select className="block-select" value={riskLevel} onChange={e => setRiskLevel(e.target.value)}>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Mitigation Required</label>
              <input className="block-input" value={mitigation} onChange={e => setMitigation(e.target.value)} placeholder="Compensating control..." />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button className="block-btn block-btn-ghost" onClick={() => setShowDeclareForm(false)}>Cancel</button>
            <button className="block-btn block-btn-primary" onClick={handleDeclare} disabled={declaring}>
              {declaring ? 'Declaring...' : 'Declare Rule'}
            </button>
          </div>
        </div>
      )}

      {/* Assign Form */}
      {showAssignForm && (
        <div className="block-card p-4 space-y-3">
          {assignError && <ErrorBanner message={assignError} onDismiss={() => setAssignError('')} />}
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Assign Function to User</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">User ID *</label>
              <input className="block-input" value={assignUserId} onChange={e => setAssignUserId(e.target.value)} placeholder="User identifier" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Function Code *</label>
              <input className="block-input" value={assignFunc} onChange={e => setAssignFunc(e.target.value)} placeholder="e.g. AP_APPROVE" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Granted By</label>
              <input className="block-input" value={assignGrantedBy} onChange={e => setAssignGrantedBy(e.target.value)} placeholder="Manager name" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button className="block-btn block-btn-ghost" onClick={() => setShowAssignForm(false)}>Cancel</button>
            <button className="block-btn block-btn-primary" onClick={handleAssign} disabled={assigning}>
              {assigning ? 'Assigning...' : 'Assign Function'}
            </button>
          </div>
        </div>
      )}

      {/* Check Form */}
      {showCheckForm && (
        <div className="block-card p-4 space-y-3">
          {checkError && <ErrorBanner message={checkError} onDismiss={() => setCheckError('')} />}
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Check SoD for User</p>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-xs text-text-muted mb-1">User ID *</label>
              <input className="block-input" value={checkUserId} onChange={e => setCheckUserId(e.target.value)} placeholder="User identifier" />
            </div>
            <button className="block-btn block-btn-primary" onClick={handleCheck} disabled={checking}>
              {checking ? 'Checking...' : 'Check'}
            </button>
          </div>
          {checkResult && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <span className="text-xs text-text-muted">Assigned functions:</span>
                {checkResult.assigned_functions.length === 0
                  ? <span className="text-xs text-text-muted italic">none</span>
                  : checkResult.assigned_functions.map(f => (
                    <span key={f} className="block-badge block-badge-blue">{f}</span>
                  ))}
              </div>
              {checkResult.conflicts.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-accent-income">
                  <CheckCircle size={14} />
                  <span>No SoD conflicts detected.</span>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm text-accent-expense">
                    <XCircle size={14} />
                    <span>{checkResult.conflicts.length} conflict{checkResult.conflicts.length !== 1 ? 's' : ''} detected</span>
                  </div>
                  {checkResult.conflicts.map(c => (
                    <div key={c.id} className="flex items-center gap-2 text-xs text-text-secondary pl-5">
                      <AlertTriangle size={11} className="text-accent-warning shrink-0" />
                      <span className="font-mono">{c.conflicting_function_a}</span>
                      <span className="text-text-muted">↔</span>
                      <span className="font-mono">{c.conflicting_function_b}</span>
                      <span className={RISK_LEVEL_BADGE[c.risk_level] || 'block-badge'}>{c.risk_level}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Conflicts List */}
      {loading ? (
        <p className="text-xs text-text-muted">Loading SoD rules...</p>
      ) : conflicts.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><ShieldCheck size={22} className="text-text-muted" /></div>
          <p className="text-sm text-text-secondary font-medium">No SoD rules declared</p>
          <p className="text-xs text-text-muted mt-1">Declare conflict pairs to enable segregation-of-duties checking.</p>
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden">
          <table className="block-table">
            <thead>
              <tr>
                <th>Function A</th>
                <th>Function B</th>
                <th>Risk Level</th>
                <th>Mitigation</th>
              </tr>
            </thead>
            <tbody>
              {conflicts.map(c => (
                <tr key={c.id}>
                  <td className="font-mono text-xs">{c.conflicting_function_a}</td>
                  <td className="font-mono text-xs">{c.conflicting_function_b}</td>
                  <td><span className={RISK_LEVEL_BADGE[c.risk_level] || 'block-badge'}>{c.risk_level}</span></td>
                  <td className="text-text-muted text-xs">{c.mitigation_required || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ─── Main Component ────────────────────────────────────────
const SoxControls: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [controls, setControls] = useState<SoxControl[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [controlsKey, setControlsKey] = useState(0);
  const [showAddForm, setShowAddForm] = useState(false);

  const load = useCallback(() => {
    if (!activeCompany) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    api.soxControlsList(activeCompany.id)
      .then((rows: SoxControl[]) => { if (!cancelled) setControls(Array.isArray(rows) ? rows : []); })
      .catch((e: any) => { if (!cancelled) setError(e?.message || 'Failed to load controls'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeCompany, controlsKey]);

  useEffect(() => { load(); }, [load]);

  const refresh = () => setControlsKey(k => k + 1);

  if (!activeCompany) {
    return <div className="flex items-center justify-center h-64 text-text-muted text-sm">No active company.</div>;
  }

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      {error && <ErrorBanner message={error} title="Error" onDismiss={() => setError('')} />}

      {/* ── SOX Controls ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-accent-primary" />
            <h3 className="text-sm font-semibold text-text-primary">SOX Controls</h3>
            <span className="block-badge block-badge-blue">{controls.length}</span>
          </div>
          <button className="block-btn block-btn-primary text-xs" onClick={() => setShowAddForm(v => !v)}>
            <Plus size={12} className="inline mr-1" />{showAddForm ? 'Cancel' : 'Add Control'}
          </button>
        </div>

        {showAddForm && (
          <ControlForm
            companyId={activeCompany.id}
            onSaved={() => { setShowAddForm(false); refresh(); }}
            onCancel={() => setShowAddForm(false)}
          />
        )}

        {loading ? (
          <div className="flex items-center justify-center h-24 text-text-muted text-sm">Loading controls...</div>
        ) : controls.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><ShieldCheck size={24} className="text-text-muted" /></div>
            <p className="text-sm text-text-secondary font-medium">No SOX controls defined</p>
            <p className="text-xs text-text-muted mt-1">Add controls to track SOX compliance testing.</p>
          </div>
        ) : (
          <div className="block-card p-0 overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-2 bg-bg-tertiary border-b border-border-primary text-xs font-semibold text-text-muted uppercase tracking-wide">
              <span className="w-5 shrink-0"></span>
              <span className="w-24 shrink-0">Code</span>
              <span className="flex-1">Description</span>
              <span className="w-24 shrink-0">Owner</span>
              <span className="w-20 shrink-0">Frequency</span>
              <span className="w-16 shrink-0">Risk</span>
              <span className="w-16 shrink-0">Last</span>
              <span className="w-14 shrink-0">Tests</span>
              <span className="w-20 shrink-0"></span>
            </div>
            {controls.map(ctrl => (
              <ControlRow key={ctrl.id} control={ctrl} companyId={activeCompany.id} onRefresh={refresh} />
            ))}
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-border-primary" />

      {/* ── SoD Section ── */}
      <SodSection companyId={activeCompany.id} />
    </div>
  );
};

export default SoxControls;
