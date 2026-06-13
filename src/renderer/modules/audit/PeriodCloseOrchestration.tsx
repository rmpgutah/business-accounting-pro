import React, { useEffect, useState, useCallback } from 'react';
import {
  Calendar, Lock, RotateCcw, CheckCircle2, AlertTriangle,
  ChevronDown, ChevronRight, Plus, Save, RefreshCw, FileText, ListChecks,
} from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import { useCompanyStore } from '../../stores/companyStore';

// ─── Types ─────────────────────────────────────────────────────────────────

interface CycleDashboard {
  closes: Array<{
    period_start: string; period_end: string; closed_at: string;
    closed_by: string; net_income: number; is_short_period: number; reopened_at: string | null;
  }>;
  locks: Array<{
    period_start: string; period_end: string; locked_through_date: string;
    lock_level: string; unlocked_at: string | null;
  }>;
  checklists: Array<{ period_label: string; total: number; done: number }>;
}

interface YearEndClose {
  id: string; fiscal_year: number; closed_at: string; closed_by: string;
  retained_earnings_account_id?: string; notes?: string;
}

interface CloseTemplate {
  id?: string; name: string; description?: string; items: string;
}

interface QuarterChecklist {
  items: Array<{ key: string; label: string; done: boolean }>;
  quarter_end_date: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const badge = (label: string, variant: 'income' | 'expense' | 'warning' | 'blue' | 'purple') => (
  <span className={`block-badge block-badge-${variant}`}>{label}</span>
);

const Section: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }> = ({
  title, icon, children, defaultOpen = true,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="block-card p-0 overflow-hidden">
      <button
        className="flex items-center gap-2 px-4 py-3 w-full text-left hover:bg-bg-tertiary transition-colors border-b border-border-primary"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-accent-primary">{icon}</span>
        <span className="text-sm font-semibold text-text-primary flex-1">{title}</span>
        {open ? <ChevronDown size={14} className="text-text-muted" /> : <ChevronRight size={14} className="text-text-muted" />}
      </button>
      {open && <div className="p-4">{children}</div>}
    </div>
  );
};

// ─── Cycle Dashboard ───────────────────────────────────────────────────────

const CycleDashboardPanel: React.FC<{ companyId: string }> = ({ companyId }) => {
  const [data, setData] = useState<CycleDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.closeCycleDashboard(companyId)
      .then(r => { if (!cancelled) { if (r?.error) setErr(r.error); else setData(r); } })
      .catch(e => { if (!cancelled) setErr(e?.message || 'Load failed'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [companyId]);

  if (loading) return <div className="text-xs text-text-muted py-4 text-center">Loading dashboard...</div>;
  if (err) return <div className="text-xs text-accent-expense">{err}</div>;
  if (!data) return null;

  const { closes, locks, checklists } = data;

  return (
    <div className="space-y-4">
      {/* Closed periods */}
      <div>
        <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Recent Closes</div>
        {closes.length === 0 ? (
          <p className="text-xs text-text-muted">No closed periods yet.</p>
        ) : (
          <div className="block-card p-0 overflow-hidden">
            <table className="block-table">
              <thead>
                <tr>
                  <th>Period</th><th>Closed</th><th>By</th><th>Net Income</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {closes.slice(0, 12).map((c, i) => (
                  <tr key={i}>
                    <td className="font-mono text-xs text-text-secondary">{c.period_start} – {c.period_end}</td>
                    <td className="text-xs text-text-muted">{c.closed_at ? formatDate(c.closed_at) : '—'}</td>
                    <td className="text-xs text-text-secondary">{c.closed_by || '—'}</td>
                    <td className="font-mono text-xs">{typeof c.net_income === 'number' ? formatCurrency(c.net_income) : '—'}</td>
                    <td>
                      {c.reopened_at
                        ? badge('Reopened', 'warning')
                        : c.is_short_period
                        ? badge('Short', 'blue')
                        : badge('Closed', 'income')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Locks */}
      <div>
        <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Period Locks</div>
        {locks.length === 0 ? (
          <p className="text-xs text-text-muted">No locks recorded.</p>
        ) : (
          <div className="block-card p-0 overflow-hidden">
            <table className="block-table">
              <thead>
                <tr><th>Period</th><th>Through</th><th>Level</th><th>Status</th></tr>
              </thead>
              <tbody>
                {locks.slice(0, 12).map((l, i) => (
                  <tr key={i}>
                    <td className="font-mono text-xs text-text-secondary">{l.period_start} – {l.period_end}</td>
                    <td className="text-xs text-text-muted">{l.locked_through_date || '—'}</td>
                    <td>{badge(l.lock_level || 'hard', 'purple')}</td>
                    <td>{l.unlocked_at ? badge('Unlocked', 'warning') : badge('Locked', 'expense')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Checklist progress */}
      {checklists.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Checklist Progress</div>
          <div className="space-y-1">
            {checklists.slice(0, 8).map((c, i) => {
              const pct = c.total > 0 ? Math.round((c.done / c.total) * 100) : 0;
              return (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-text-muted font-mono w-32 shrink-0">{c.period_label}</span>
                  <div className="flex-1 h-1.5 bg-bg-tertiary border border-border-primary" style={{ borderRadius: 'var(--app-radius)' }}>
                    <div
                      className="h-full bg-accent-primary"
                      style={{ borderRadius: 'var(--app-radius)', width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs text-text-secondary w-12 text-right">{c.done}/{c.total}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Run Month-Close ────────────────────────────────────────────────────────

const RunMonthClose: React.FC<{ companyId: string }> = ({ companyId }) => {
  void companyId; // companyId comes from db.getCurrentCompanyId() server-side
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  const run = async () => {
    if (!window.confirm(`Run month-end close for ${year}-${String(month).padStart(2, '0')}? This will post closing entries and cannot be undone.`)) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await api.closeRunMonth(year, month);
      setResult(r);
    } catch (e: any) {
      setResult({ error: e?.message });
    } finally {
      setBusy(false);
    }
  };

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <label className="block text-[11px] text-text-muted mb-1">Year</label>
          <input
            type="number"
            className="block-input w-24"
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            min={2000} max={2100}
          />
        </div>
        <div>
          <label className="block text-[11px] text-text-muted mb-1">Month</label>
          <select className="block-select" value={month} onChange={e => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div className="pt-5">
          <button className="block-btn-primary flex items-center gap-1.5" onClick={run} disabled={busy}>
            <RefreshCw size={13} />
            {busy ? 'Running...' : 'Run Month-End Close'}
          </button>
        </div>
      </div>
      {result && (
        <div className={`text-xs px-3 py-2 border ${result.error ? 'text-accent-expense border-accent-expense/20 bg-accent-expense/5' : 'text-accent-income border-accent-income/20 bg-accent-income/5'}`}
          style={{ borderRadius: 'var(--app-radius)' }}>
          {result.error
            ? `Error: ${result.error}`
            : `Success. JE: ${result.entry_number || result.je_id || 'posted'}. Adjustments: ${result.adjustmentCount ?? result.lines?.length ?? '—'}.`}
        </div>
      )}
    </div>
  );
};

// ─── Lock Period ────────────────────────────────────────────────────────────

const LockPeriod: React.FC<{ companyId: string }> = ({ companyId }) => {
  const today = new Date();
  const [periodStart, setPeriodStart] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`);
  const [periodEnd, setPeriodEnd] = useState(() => {
    const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return last.toISOString().split('T')[0];
  });
  const [reason, setReason] = useState('');
  const [lockLevel, setLockLevel] = useState<'soft' | 'hard'>('hard');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  const lock = async () => {
    if (!window.confirm(`Lock period ${periodStart} – ${periodEnd} (${lockLevel})? Posting will be blocked.`)) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await api.closeLockPeriodV2(companyId, periodStart, periodEnd, 'admin', reason, lockLevel);
      setResult(r);
    } catch (e: any) {
      setResult({ error: e?.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] text-text-muted mb-1">Period Start</label>
          <input type="date" className="block-input" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
        </div>
        <div>
          <label className="block text-[11px] text-text-muted mb-1">Period End</label>
          <input type="date" className="block-input" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="block text-[11px] text-text-muted mb-1">Reason (optional)</label>
          <input type="text" className="block-input" value={reason} onChange={e => setReason(e.target.value)} placeholder="Month-end close" />
        </div>
        <div>
          <label className="block text-[11px] text-text-muted mb-1">Level</label>
          <select className="block-select" value={lockLevel} onChange={e => setLockLevel(e.target.value as 'soft' | 'hard')}>
            <option value="hard">Hard</option>
            <option value="soft">Soft</option>
          </select>
        </div>
        <div className="pt-5">
          <button className="block-btn flex items-center gap-1.5 text-accent-expense" onClick={lock} disabled={busy}>
            <Lock size={13} />
            {busy ? 'Locking...' : 'Lock Period'}
          </button>
        </div>
      </div>
      {result && (
        <div className={`text-xs px-3 py-2 border ${result.error ? 'text-accent-expense border-accent-expense/20 bg-accent-expense/5' : 'text-accent-income border-accent-income/20 bg-accent-income/5'}`}
          style={{ borderRadius: 'var(--app-radius)' }}>
          {result.error ? `Error: ${result.error}` : `Period locked. Lock ID: ${result.lockId || result.id || 'saved'}.`}
        </div>
      )}
    </div>
  );
};

// ─── Roll-Forward ───────────────────────────────────────────────────────────

const RollForward: React.FC<{ companyId: string }> = ({ companyId }) => {
  const [logId, setLogId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  const roll = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await api.closeRollForward(companyId, logId || undefined);
      setResult(r);
    } catch (e: any) {
      setResult({ error: e?.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-muted">Roll forward retained-earnings balances to the next period. Optionally supply a close-log ID to roll a specific close.</p>
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="block text-[11px] text-text-muted mb-1">Close Log ID (optional)</label>
          <input type="text" className="block-input font-mono text-xs" value={logId} onChange={e => setLogId(e.target.value)} placeholder="Leave blank for latest" />
        </div>
        <div className="pt-5">
          <button className="block-btn-primary flex items-center gap-1.5" onClick={roll} disabled={busy}>
            <RotateCcw size={13} />
            {busy ? 'Rolling...' : 'Roll Forward'}
          </button>
        </div>
      </div>
      {result && (
        <div className={`text-xs px-3 py-2 border ${result.error ? 'text-accent-expense border-accent-expense/20 bg-accent-expense/5' : 'text-accent-income border-accent-income/20 bg-accent-income/5'}`}
          style={{ borderRadius: 'var(--app-radius)' }}>
          {result.error ? `Error: ${result.error}` : `Roll-forward complete. New RE balance: ${typeof result.new_balance === 'number' ? formatCurrency(result.new_balance) : '—'}.`}
        </div>
      )}
    </div>
  );
};

// ─── Year-End & Quarter Checklists ─────────────────────────────────────────

const YearEndPanel: React.FC<{ companyId: string }> = ({ companyId }) => {
  void companyId;
  const [yearEnds, setYearEnds] = useState<YearEndClose[]>([]);
  const [loading, setLoading] = useState(true);
  const [quarterDate, setQuarterDate] = useState('');
  const [quarterChecklist, setQuarterChecklist] = useState<QuarterChecklist | null>(null);
  const [busy, setBusy] = useState(false);
  const [yeForm, setYeForm] = useState({ fiscal_year: new Date().getFullYear(), notes: '' });
  const [yeResult, setYeResult] = useState<any>(null);

  const loadYearEnds = useCallback(async () => {
    let cancelled = false;
    setLoading(true);
    try {
      const r = await api.featCloseListYearEnds();
      if (!cancelled) setYearEnds(Array.isArray(r) ? r : []);
    } finally {
      if (!cancelled) setLoading(false);
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { loadYearEnds(); }, [loadYearEnds]);

  const runYearEnd = async () => {
    setBusy(true);
    setYeResult(null);
    try {
      const r = await api.featCloseYearEnd({ fiscal_year: yeForm.fiscal_year, notes: yeForm.notes });
      setYeResult(r);
      await loadYearEnds();
    } catch (e: any) {
      setYeResult({ error: e?.message });
    } finally {
      setBusy(false);
    }
  };

  const loadQuarterChecklist = async () => {
    if (!quarterDate) return;
    setBusy(true);
    try {
      const r = await api.featCloseQuarterChecklist(quarterDate);
      setQuarterChecklist(r);
    } catch (e: any) {
      setQuarterChecklist(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Year-end closes history */}
      <div>
        <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Year-End Closes</div>
        {loading ? (
          <div className="text-xs text-text-muted">Loading...</div>
        ) : yearEnds.length === 0 ? (
          <p className="text-xs text-text-muted">No year-end closes on record.</p>
        ) : (
          <div className="block-card p-0 overflow-hidden">
            <table className="block-table">
              <thead><tr><th>Fiscal Year</th><th>Closed</th><th>By</th><th>Notes</th></tr></thead>
              <tbody>
                {yearEnds.map((ye: any, i: number) => (
                  <tr key={i}>
                    <td className="font-mono text-xs">{ye.fiscal_year}</td>
                    <td className="text-xs text-text-muted">{ye.closed_at ? formatDate(ye.closed_at) : '—'}</td>
                    <td className="text-xs text-text-secondary">{ye.closed_by || '—'}</td>
                    <td className="text-xs text-text-muted">{ye.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Run year-end */}
      <div>
        <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Run Year-End Close</div>
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-[11px] text-text-muted mb-1">Fiscal Year</label>
            <input type="number" className="block-input w-24" value={yeForm.fiscal_year}
              onChange={e => setYeForm(f => ({ ...f, fiscal_year: Number(e.target.value) }))} min={2000} max={2100} />
          </div>
          <div className="flex-1">
            <label className="block text-[11px] text-text-muted mb-1">Notes</label>
            <input type="text" className="block-input" value={yeForm.notes}
              onChange={e => setYeForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes" />
          </div>
          <button className="block-btn-primary flex items-center gap-1.5" onClick={runYearEnd} disabled={busy}>
            <Calendar size={13} />
            {busy ? 'Running...' : 'Run Year-End'}
          </button>
        </div>
        {yeResult && (
          <div className={`mt-2 text-xs px-3 py-2 border ${yeResult.error ? 'text-accent-expense border-accent-expense/20 bg-accent-expense/5' : 'text-accent-income border-accent-income/20 bg-accent-income/5'}`}
            style={{ borderRadius: 'var(--app-radius)' }}>
            {yeResult.error ? `Error: ${yeResult.error}` : `Year-end close recorded for FY${yeResult.fiscal_year || yeForm.fiscal_year}.`}
          </div>
        )}
      </div>

      {/* Quarter checklist */}
      <div>
        <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Quarter-End Checklist</div>
        <div className="flex items-end gap-3">
          <div>
            <label className="block text-[11px] text-text-muted mb-1">Quarter End Date</label>
            <input type="date" className="block-input" value={quarterDate} onChange={e => setQuarterDate(e.target.value)} />
          </div>
          <button className="block-btn flex items-center gap-1.5" onClick={loadQuarterChecklist} disabled={busy || !quarterDate}>
            <ListChecks size={13} />
            Load Checklist
          </button>
        </div>
        {quarterChecklist && (
          <div className="mt-3 space-y-1">
            {Array.isArray(quarterChecklist.items) && quarterChecklist.items.length > 0 ? (
              quarterChecklist.items.map((item: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  {item.done
                    ? <CheckCircle2 size={13} className="text-accent-income shrink-0" />
                    : <AlertTriangle size={13} className="text-accent-warning shrink-0" />}
                  <span className={item.done ? 'text-text-muted line-through' : 'text-text-secondary'}>{item.label || item.key}</span>
                </div>
              ))
            ) : (
              <p className="text-xs text-text-muted">No checklist items returned.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Close Templates ────────────────────────────────────────────────────────

const CloseTemplates: React.FC = () => {
  const [templates, setTemplates] = useState<CloseTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CloseTemplate | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    let cancelled = false;
    setLoading(true);
    try {
      const r = await api.featCloseTplList();
      if (!cancelled) setTemplates(Array.isArray(r) ? r : []);
    } finally {
      if (!cancelled) setLoading(false);
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await api.featCloseTplUpsert(editing);
      await load();
      setEditing(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="text-xs text-text-muted">Loading...</div>
      ) : templates.length === 0 && !editing ? (
        <p className="text-xs text-text-muted">No close templates yet.</p>
      ) : null}

      {templates.length > 0 && (
        <div className="block-card p-0 overflow-hidden">
          <table className="block-table">
            <thead><tr><th>Name</th><th>Description</th><th>Items</th><th></th></tr></thead>
            <tbody>
              {templates.map((t: any, i: number) => (
                <tr key={i}>
                  <td className="text-xs font-medium text-text-primary">{t.name}</td>
                  <td className="text-xs text-text-muted">{t.description || '—'}</td>
                  <td className="text-xs text-text-muted font-mono">
                    {(() => {
                      try { return JSON.parse(t.items || '[]').length + ' items'; } catch { return '—'; }
                    })()}
                  </td>
                  <td>
                    <button className="text-xs text-accent-primary hover:underline" onClick={() => setEditing({ ...t })}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <div className="block-card space-y-3">
          <div className="text-xs font-semibold text-text-primary">{editing.id ? 'Edit Template' : 'New Template'}</div>
          <div>
            <label className="block text-[11px] text-text-muted mb-1">Name</label>
            <input type="text" className="block-input" value={editing.name} onChange={e => setEditing(f => f ? { ...f, name: e.target.value } : f)} />
          </div>
          <div>
            <label className="block text-[11px] text-text-muted mb-1">Description</label>
            <input type="text" className="block-input" value={editing.description || ''} onChange={e => setEditing(f => f ? { ...f, description: e.target.value } : f)} />
          </div>
          <div>
            <label className="block text-[11px] text-text-muted mb-1">Items (JSON array of strings)</label>
            <textarea className="block-input font-mono text-xs h-20 resize-y" value={editing.items || '[]'} onChange={e => setEditing(f => f ? { ...f, items: e.target.value } : f)} />
          </div>
          <div className="flex gap-2">
            <button className="block-btn-primary flex items-center gap-1.5 text-xs" onClick={save} disabled={busy}>
              <Save size={12} />{busy ? 'Saving...' : 'Save'}
            </button>
            <button className="block-btn text-xs" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="block-btn flex items-center gap-1.5 text-xs" onClick={() => setEditing({ name: '', items: '[]' })}>
          <Plus size={12} /> New Template
        </button>
      )}
    </div>
  );
};

// ─── Main Component ─────────────────────────────────────────────────────────

const PeriodCloseOrchestration: React.FC = () => {
  const activeCompany = useCompanyStore(s => s.activeCompany);
  const companyId = activeCompany?.id || '';

  if (!activeCompany) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Select a company to view close orchestration.
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      <div className="flex items-center gap-2 mb-2">
        <FileText size={16} className="text-accent-primary" />
        <h3 className="text-sm font-semibold text-text-primary">Period Close Orchestration</h3>
        <span className="text-xs text-text-muted">– close cycle, lock, roll-forward, year-end, templates</span>
      </div>

      <Section title="Close Cycle Dashboard" icon={<Calendar size={14} />}>
        <CycleDashboardPanel companyId={companyId} />
      </Section>

      <Section title="Run Month-End Close" icon={<RefreshCw size={14} />} defaultOpen={false}>
        <RunMonthClose companyId={companyId} />
      </Section>

      <Section title="Lock Period" icon={<Lock size={14} />} defaultOpen={false}>
        <LockPeriod companyId={companyId} />
      </Section>

      <Section title="Roll Forward" icon={<RotateCcw size={14} />} defaultOpen={false}>
        <RollForward companyId={companyId} />
      </Section>

      <Section title="Year-End &amp; Quarter Checklists" icon={<ListChecks size={14} />} defaultOpen={false}>
        <YearEndPanel companyId={companyId} />
      </Section>

      <Section title="Close Templates" icon={<FileText size={14} />} defaultOpen={false}>
        <CloseTemplates />
      </Section>
    </div>
  );
};

export default PeriodCloseOrchestration;
