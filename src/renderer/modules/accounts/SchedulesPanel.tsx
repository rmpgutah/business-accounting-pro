/**
 * SchedulesPanel — ASC 606 deferred revenue recognition + prepaid/accrual schedulers.
 * Feature #41 (deferred-rev, obligations, SSP, bundle) + Feature #42 (prepaid, accrual, comm-defer).
 */
import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, CheckCircle, AlertCircle, ChevronDown, ChevronUp, Plus } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate, humanizeLabel } from '../../lib/format';

// ─── Sub-tab type ────────────────────────────────────────
type SubTab = 'revenue' | 'prepaid-accrual';

// ─── Helpers ─────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    active: 'text-accent-income',
    completed: 'text-text-muted',
    posted: 'text-accent-blue',
    draft: 'text-accent-warning',
    reversed: 'text-text-muted',
    pending: 'text-accent-warning',
  };
  const cls = colorMap[status] ?? 'text-text-secondary';
  return <span className={`text-xs font-semibold uppercase ${cls}`}>{humanizeLabel(status)}</span>;
}

function SectionHeader({ title, count, expanded, onToggle }: {
  title: string; count?: number; expanded: boolean; onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between px-3 py-2 bg-bg-secondary border border-border-primary text-xs font-bold uppercase text-text-secondary hover:text-text-primary transition-colors"
      style={{ borderRadius: 'var(--app-radius)' }}
    >
      <span>{title}{count !== undefined ? ` (${count})` : ''}</span>
      {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
    </button>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center text-text-muted text-xs py-6">{message}</div>
  );
}

// ─── Revenue Recognition Panel ───────────────────────────
const RevenueSub: React.FC = () => {
  const [schedules, setSchedules] = useState<any[]>([]);
  const [dueItems, setDueItems] = useState<any[]>([]);
  const [ssps, setSSPs] = useState<any[]>([]);
  const [loadingSchedules, setLoadingSchedules] = useState(false);
  const [loadingDue, setLoadingDue] = useState(false);
  const [loadingSSPs, setLoadingSSPs] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showSSPForm, setShowSSPForm] = useState(false);
  const [showBundleCalc, setShowBundleCalc] = useState(false);
  const [schedulesExpanded, setSchedulesExpanded] = useState(true);
  const [dueExpanded, setDueExpanded] = useState(true);
  const [sspExpanded, setSSPExpanded] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // Create form state
  const [form, setForm] = useState({
    description: '', total_amount: '', start_date: '', end_date: '',
    recognition_periods: '12', notes: '',
  });
  // SSP form state
  const [sspForm, setSSPForm] = useState({
    product_or_service: '', ssp_value: '', ssp_method: 'observable', effective_from: '',
  });
  // Bundle calc state
  const [bundleItems, setBundleItems] = useState([{ obligation_id: '', ssp: '' }]);
  const [bundlePrice, setBundlePrice] = useState('');
  const [bundleResult, setBundleResult] = useState<any[] | null>(null);

  const flash = (text: string, ok: boolean) => {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 3500);
  };

  const loadSchedules = useCallback(() => {
    let cancelled = false;
    setLoadingSchedules(true);
    api.featDeferredRevList().then((res: any) => {
      if (cancelled) return;
      setSchedules(Array.isArray(res) ? res : []);
      setLoadingSchedules(false);
    }).catch(() => { if (!cancelled) setLoadingSchedules(false); });
    return () => { cancelled = true; };
  }, []);

  const loadDue = useCallback(() => {
    let cancelled = false;
    setLoadingDue(true);
    api.featDeferredRevDue().then((res: any) => {
      if (cancelled) return;
      setDueItems(Array.isArray(res) ? res : []);
      setLoadingDue(false);
    }).catch(() => { if (!cancelled) setLoadingDue(false); });
    return () => { cancelled = true; };
  }, []);

  const loadSSPs = useCallback(() => {
    let cancelled = false;
    setLoadingSSPs(true);
    api.featSSPList().then((res: any) => {
      if (cancelled) return;
      setSSPs(Array.isArray(res) ? res : []);
      setLoadingSSPs(false);
    }).catch(() => { if (!cancelled) setLoadingSSPs(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    loadSchedules();
    loadDue();
    loadSSPs();
  }, [loadSchedules, loadDue, loadSSPs]);

  const handleRecognize = async (item: any) => {
    const today = new Date().toISOString().slice(0, 10);
    if (!window.confirm(`Recognize ${formatCurrency(item.period_amount)} for "${item.description}" as of ${today}?`)) return;
    setBusyId(item.id);
    try {
      const res: any = await api.featDeferredRevRecognize(item.id, today);
      if (res?.error) { flash(res.error, false); }
      else { flash(`Recognized ${formatCurrency(res?.recognized_amount ?? item.period_amount)}. Periods remaining: ${res?.periods_remaining ?? '—'}`, true); }
      loadDue();
      loadSchedules();
    } catch (e: any) {
      flash(e?.message ?? 'Error', false);
    } finally {
      setBusyId(null);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      description: form.description,
      total_amount: parseFloat(form.total_amount) || 0,
      start_date: form.start_date,
      end_date: form.end_date,
      recognition_periods: parseInt(form.recognition_periods) || 12,
      notes: form.notes || undefined,
    };
    try {
      const res: any = await api.featDeferredRevCreate(payload);
      if (res?.error) { flash(res.error, false); return; }
      flash(`Schedule created. Period amount: ${formatCurrency(res?.period_amount)}`, true);
      setForm({ description: '', total_amount: '', start_date: '', end_date: '', recognition_periods: '12', notes: '' });
      setShowCreateForm(false);
      loadSchedules();
      loadDue();
    } catch (e: any) {
      flash(e?.message ?? 'Error', false);
    }
  };

  const handleSSPCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      product_or_service: sspForm.product_or_service,
      ssp_value: parseFloat(sspForm.ssp_value) || 0,
      ssp_method: sspForm.ssp_method,
      effective_from: sspForm.effective_from || undefined,
    };
    try {
      const res: any = await api.featSSPUpsert(payload);
      if (res?.error) { flash(res.error, false); return; }
      flash('SSP saved.', true);
      setSSPForm({ product_or_service: '', ssp_value: '', ssp_method: 'observable', effective_from: '' });
      setShowSSPForm(false);
      loadSSPs();
    } catch (e: any) {
      flash(e?.message ?? 'Error', false);
    }
  };

  const handleBundleAllocate = async (e: React.FormEvent) => {
    e.preventDefault();
    const items = bundleItems
      .filter(i => i.obligation_id && i.ssp)
      .map(i => ({ obligation_id: i.obligation_id, ssp: parseFloat(i.ssp) || 0 }));
    const txPrice = parseFloat(bundlePrice) || 0;
    try {
      const res: any = await api.featBundleAllocate(items, txPrice);
      if (res?.error) { flash(res.error, false); return; }
      setBundleResult(Array.isArray(res) ? res : []);
    } catch (e: any) {
      flash(e?.message ?? 'Error', false);
    }
  };

  return (
    <div className="space-y-4">
      {msg && (
        <div className={`flex items-center gap-2 px-3 py-2 text-xs border ${msg.ok ? 'border-accent-income text-accent-income' : 'border-accent-expense text-accent-expense'}`}
          style={{ borderRadius: 'var(--app-radius)' }}>
          {msg.ok ? <CheckCircle size={13} /> : <AlertCircle size={13} />}
          {msg.text}
        </div>
      )}

      {/* Due to Recognize */}
      <div>
        <SectionHeader
          title="Due to Recognize"
          count={dueItems.length}
          expanded={dueExpanded}
          onToggle={() => setDueExpanded(v => !v)}
        />
        {dueExpanded && (
          <div className="mt-1">
            {loadingDue
              ? <div className="text-text-muted text-xs py-3 px-2">Loading…</div>
              : dueItems.length === 0
                ? <EmptyState message="No deferred revenue recognition due." />
                : (
                  <table className="block-table w-full text-xs">
                    <thead>
                      <tr>
                        <th className="text-left">Description</th>
                        <th className="text-right">Period Amount</th>
                        <th className="text-left">Next Recognition</th>
                        <th className="text-left">Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {dueItems.map((item: any) => (
                        <tr key={item.id}>
                          <td className="text-text-primary">{item.description}</td>
                          <td className="text-right font-mono text-accent-income">{formatCurrency(item.period_amount)}</td>
                          <td>{formatDate(item.next_recognition_date)}</td>
                          <td><StatusBadge status={item.status} /></td>
                          <td className="text-right">
                            <button
                              className="block-btn text-xs"
                              disabled={busyId === item.id}
                              onClick={() => handleRecognize(item)}
                            >
                              {busyId === item.id ? 'Posting…' : 'Recognize'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
          </div>
        )}
      </div>

      {/* All Deferred Revenue Schedules */}
      <div>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <SectionHeader
              title="Deferred Revenue Schedules"
              count={schedules.length}
              expanded={schedulesExpanded}
              onToggle={() => setSchedulesExpanded(v => !v)}
            />
          </div>
          <button
            className="block-btn text-xs flex items-center gap-1"
            onClick={() => setShowCreateForm(v => !v)}
          >
            <Plus size={12} /> New Schedule
          </button>
          <button className="block-btn text-xs" title="Refresh" onClick={loadSchedules}>
            <RefreshCw size={12} className={loadingSchedules ? 'animate-spin' : ''} />
          </button>
        </div>

        {showCreateForm && (
          <form onSubmit={handleCreate} className="block-card mt-2 space-y-3" style={{ padding: 16 }}>
            <div className="text-xs font-bold uppercase text-text-secondary mb-2">New Deferred Revenue Schedule</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs text-text-muted mb-1">Description *</label>
                <input
                  className="block-input w-full text-xs"
                  required
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="e.g. Annual SaaS subscription — ACME Corp"
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Total Amount *</label>
                <input
                  type="number"
                  step="0.01"
                  className="block-input w-full text-xs"
                  required
                  value={form.total_amount}
                  onChange={e => setForm(f => ({ ...f, total_amount: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Recognition Periods</label>
                <input
                  type="number"
                  min="1"
                  className="block-input w-full text-xs"
                  value={form.recognition_periods}
                  onChange={e => setForm(f => ({ ...f, recognition_periods: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Start Date *</label>
                <input
                  type="date"
                  className="block-input w-full text-xs"
                  required
                  value={form.start_date}
                  onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">End Date *</label>
                <input
                  type="date"
                  className="block-input w-full text-xs"
                  required
                  value={form.end_date}
                  onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-text-muted mb-1">Notes</label>
                <input
                  className="block-input w-full text-xs"
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" className="block-btn text-xs" onClick={() => setShowCreateForm(false)}>Cancel</button>
              <button type="submit" className="block-btn block-btn-primary text-xs">Create Schedule</button>
            </div>
          </form>
        )}

        {schedulesExpanded && (
          <div className="mt-1">
            {loadingSchedules
              ? <div className="text-text-muted text-xs py-3 px-2">Loading…</div>
              : schedules.length === 0
                ? <EmptyState message="No deferred revenue schedules found." />
                : (
                  <table className="block-table w-full text-xs">
                    <thead>
                      <tr>
                        <th className="text-left">Description</th>
                        <th className="text-right">Total</th>
                        <th className="text-right">Period Amt</th>
                        <th className="text-left">Start</th>
                        <th className="text-left">Next Rec.</th>
                        <th className="text-right">Recognized</th>
                        <th className="text-right">Periods</th>
                        <th className="text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {schedules.map((s: any) => (
                        <tr key={s.id}>
                          <td className="text-text-primary">{s.description}</td>
                          <td className="text-right font-mono">{formatCurrency(s.total_amount)}</td>
                          <td className="text-right font-mono text-accent-income">{formatCurrency(s.period_amount)}</td>
                          <td>{formatDate(s.start_date)}</td>
                          <td>{formatDate(s.next_recognition_date)}</td>
                          <td className="text-right font-mono">{s.periods_recognized ?? 0}</td>
                          <td className="text-right">{s.recognition_periods}</td>
                          <td><StatusBadge status={s.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
          </div>
        )}
      </div>

      {/* SSP (Standalone Selling Prices) */}
      <div>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <SectionHeader
              title="Standalone Selling Prices (SSP)"
              count={ssps.length}
              expanded={sspExpanded}
              onToggle={() => setSSPExpanded(v => !v)}
            />
          </div>
          <button
            className="block-btn text-xs flex items-center gap-1"
            onClick={() => setShowSSPForm(v => !v)}
          >
            <Plus size={12} /> Add SSP
          </button>
        </div>

        {showSSPForm && (
          <form onSubmit={handleSSPCreate} className="block-card mt-2 space-y-3" style={{ padding: 16 }}>
            <div className="text-xs font-bold uppercase text-text-secondary mb-2">New Standalone Selling Price</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">Product / Service *</label>
                <input
                  className="block-input w-full text-xs"
                  required
                  value={sspForm.product_or_service}
                  onChange={e => setSSPForm(f => ({ ...f, product_or_service: e.target.value }))}
                  placeholder="e.g. Annual License"
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">SSP Value *</label>
                <input
                  type="number"
                  step="0.01"
                  className="block-input w-full text-xs"
                  required
                  value={sspForm.ssp_value}
                  onChange={e => setSSPForm(f => ({ ...f, ssp_value: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Method</label>
                <select
                  className="block-input w-full text-xs"
                  value={sspForm.ssp_method}
                  onChange={e => setSSPForm(f => ({ ...f, ssp_method: e.target.value }))}
                >
                  <option value="observable">Observable</option>
                  <option value="adjusted_market">Adjusted Market</option>
                  <option value="expected_cost_plus">Expected Cost Plus</option>
                  <option value="residual">Residual</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Effective From</label>
                <input
                  type="date"
                  className="block-input w-full text-xs"
                  value={sspForm.effective_from}
                  onChange={e => setSSPForm(f => ({ ...f, effective_from: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" className="block-btn text-xs" onClick={() => setShowSSPForm(false)}>Cancel</button>
              <button type="submit" className="block-btn block-btn-primary text-xs">Save SSP</button>
            </div>
          </form>
        )}

        {sspExpanded && (
          <div className="mt-1">
            {loadingSSPs
              ? <div className="text-text-muted text-xs py-3 px-2">Loading…</div>
              : ssps.length === 0
                ? <EmptyState message="No SSPs defined." />
                : (
                  <table className="block-table w-full text-xs">
                    <thead>
                      <tr>
                        <th className="text-left">Product / Service</th>
                        <th className="text-right">SSP Value</th>
                        <th className="text-left">Method</th>
                        <th className="text-left">Effective From</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ssps.map((s: any) => (
                        <tr key={s.id}>
                          <td className="text-text-primary">{s.product_or_service}</td>
                          <td className="text-right font-mono">{formatCurrency(s.ssp_value)}</td>
                          <td>{humanizeLabel(s.ssp_method)}</td>
                          <td>{formatDate(s.effective_from)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
          </div>
        )}
      </div>

      {/* Bundle Allocation Calculator */}
      <div>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <SectionHeader
              title="Bundle Revenue Allocation"
              count={undefined}
              expanded={showBundleCalc}
              onToggle={() => setShowBundleCalc(v => !v)}
            />
          </div>
        </div>
        {showBundleCalc && (
          <form onSubmit={handleBundleAllocate} className="block-card mt-2 space-y-3" style={{ padding: 16 }}>
            <div className="text-xs font-bold uppercase text-text-secondary mb-2">Allocate Transaction Price (ASC 606)</div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Transaction Price</label>
              <input
                type="number"
                step="0.01"
                className="block-input text-xs"
                style={{ width: 160 }}
                value={bundlePrice}
                onChange={e => setBundlePrice(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-2">
              <div className="text-xs text-text-muted">Performance Obligations (Obligation ID + SSP)</div>
              {bundleItems.map((item, idx) => (
                <div key={idx} className="flex gap-2">
                  <input
                    className="block-input text-xs flex-1"
                    placeholder="Obligation ID"
                    value={item.obligation_id}
                    onChange={e => setBundleItems(prev => prev.map((x, i) => i === idx ? { ...x, obligation_id: e.target.value } : x))}
                  />
                  <input
                    type="number"
                    step="0.01"
                    className="block-input text-xs"
                    style={{ width: 100 }}
                    placeholder="SSP"
                    value={item.ssp}
                    onChange={e => setBundleItems(prev => prev.map((x, i) => i === idx ? { ...x, ssp: e.target.value } : x))}
                  />
                  {bundleItems.length > 1 && (
                    <button type="button" className="block-btn text-xs text-accent-expense"
                      onClick={() => setBundleItems(prev => prev.filter((_, i) => i !== idx))}>
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                className="block-btn text-xs flex items-center gap-1"
                onClick={() => setBundleItems(prev => [...prev, { obligation_id: '', ssp: '' }])}
              >
                <Plus size={11} /> Add Obligation
              </button>
            </div>
            <div className="flex gap-2 justify-end">
              <button type="submit" className="block-btn block-btn-primary text-xs">Allocate</button>
            </div>
            {bundleResult && bundleResult.length > 0 && (
              <div className="mt-2">
                <div className="text-xs font-bold text-text-secondary mb-1">Allocation Result</div>
                <table className="block-table w-full text-xs">
                  <thead><tr><th className="text-left">Obligation ID</th><th className="text-right">Allocated</th></tr></thead>
                  <tbody>
                    {bundleResult.map((r: any, idx: number) => (
                      <tr key={idx}>
                        <td className="font-mono text-text-secondary">{r.obligation_id}</td>
                        <td className="text-right font-mono text-accent-income">{formatCurrency(r.allocated)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
};

// ─── Prepaid & Accruals Panel ─────────────────────────────
const PrepaidAccrualSub: React.FC = () => {
  const [prepaids, setPrepaids] = useState<any[]>([]);
  const [prepaidDue, setPrepaidDue] = useState<any[]>([]);
  const [accruals, setAccruals] = useState<any[]>([]);
  const [accrualDue, setAccrualDue] = useState<any[]>([]);
  const [commDeferrals, setCommDeferrals] = useState<any[]>([]);

  const [loadingPrepaids, setLoadingPrepaids] = useState(false);
  const [loadingPrepaidDue, setLoadingPrepaidDue] = useState(false);
  const [loadingAccruals, setLoadingAccruals] = useState(false);
  const [loadingAccrualDue, setLoadingAccrualDue] = useState(false);
  const [loadingComm, setLoadingComm] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [prepaidDueExpanded, setPrepaidDueExpanded] = useState(true);
  const [prepaidsExpanded, setPrepaidsExpanded] = useState(true);
  const [accrualDueExpanded, setAccrualDueExpanded] = useState(true);
  const [accrualsExpanded, setAccrualsExpanded] = useState(true);
  const [commExpanded, setCommExpanded] = useState(false);

  const [showPrepaidForm, setShowPrepaidForm] = useState(false);
  const [showAccrualForm, setShowAccrualForm] = useState(false);
  const [showCommForm, setShowCommForm] = useState(false);

  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const flash = (text: string, ok: boolean) => {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 3500);
  };

  // Prepaid form
  const [prepaidForm, setPrepaidForm] = useState({
    description: '', total_amount: '', start_date: '', end_date: '',
    amortization_periods: '12', notes: '',
  });
  // Accrual form
  const [accrualForm, setAccrualForm] = useState({
    description: '', amount: '', accrual_date: '', reverse_date: '',
    accrual_type: 'expense', notes: '',
  });
  // Commission deferral form
  const [commForm, setCommForm] = useState({
    commission_amount: '', amortization_period_months: '36', start_date: '', notes: '',
  });

  const loadPrepaids = useCallback(() => {
    let cancelled = false;
    setLoadingPrepaids(true);
    api.featPrepaidList().then((res: any) => {
      if (cancelled) return;
      setPrepaids(Array.isArray(res) ? res : []);
      setLoadingPrepaids(false);
    }).catch(() => { if (!cancelled) setLoadingPrepaids(false); });
    return () => { cancelled = true; };
  }, []);

  const loadPrepaidDue = useCallback(() => {
    let cancelled = false;
    setLoadingPrepaidDue(true);
    api.featPrepaidDue().then((res: any) => {
      if (cancelled) return;
      setPrepaidDue(Array.isArray(res) ? res : []);
      setLoadingPrepaidDue(false);
    }).catch(() => { if (!cancelled) setLoadingPrepaidDue(false); });
    return () => { cancelled = true; };
  }, []);

  const loadAccruals = useCallback(() => {
    let cancelled = false;
    setLoadingAccruals(true);
    api.featAccrualList().then((res: any) => {
      if (cancelled) return;
      setAccruals(Array.isArray(res) ? res : []);
      setLoadingAccruals(false);
    }).catch(() => { if (!cancelled) setLoadingAccruals(false); });
    return () => { cancelled = true; };
  }, []);

  const loadAccrualDue = useCallback(() => {
    let cancelled = false;
    setLoadingAccrualDue(true);
    api.featAccrualDueReversals().then((res: any) => {
      if (cancelled) return;
      setAccrualDue(Array.isArray(res) ? res : []);
      setLoadingAccrualDue(false);
    }).catch(() => { if (!cancelled) setLoadingAccrualDue(false); });
    return () => { cancelled = true; };
  }, []);

  const loadComm = useCallback(() => {
    let cancelled = false;
    setLoadingComm(true);
    api.featCommDeferList().then((res: any) => {
      if (cancelled) return;
      setCommDeferrals(Array.isArray(res) ? res : []);
      setLoadingComm(false);
    }).catch(() => { if (!cancelled) setLoadingComm(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    loadPrepaids();
    loadPrepaidDue();
    loadAccruals();
    loadAccrualDue();
    loadComm();
  }, [loadPrepaids, loadPrepaidDue, loadAccruals, loadAccrualDue, loadComm]);

  const handlePrepaidRecognize = async (item: any) => {
    const today = new Date().toISOString().slice(0, 10);
    if (!window.confirm(`Recognize ${formatCurrency(item.period_amount)} for "${item.description}" as of ${today}?`)) return;
    setBusyId(item.id);
    try {
      const res: any = await api.featPrepaidRecognize(item.id, today);
      if (res?.error) { flash(res.error, false); }
      else { flash(`Recognized ${formatCurrency(res?.recognized_amount ?? item.period_amount)}. Periods remaining: ${res?.periods_remaining ?? '—'}`, true); }
      loadPrepaidDue();
      loadPrepaids();
    } catch (e: any) {
      flash(e?.message ?? 'Error', false);
    } finally {
      setBusyId(null);
    }
  };

  const handleAccrualPost = async (item: any) => {
    if (!window.confirm(`Post accrual "${item.description}" (${formatCurrency(item.amount)})?`)) return;
    setBusyId(item.id);
    try {
      const res: any = await api.featAccrualPost(item.id, '');
      if (res?.error) { flash(res.error, false); }
      else { flash('Accrual posted.', true); }
      loadAccruals();
      loadAccrualDue();
    } catch (e: any) {
      flash(e?.message ?? 'Error', false);
    } finally {
      setBusyId(null);
    }
  };

  const handleAccrualMarkReversed = async (item: any) => {
    if (!window.confirm(`Mark accrual "${item.description}" as reversed?`)) return;
    setBusyId(item.id);
    try {
      const res: any = await api.featAccrualMarkReversed(item.id, '');
      if (res?.error) { flash(res.error, false); }
      else { flash('Accrual marked reversed.', true); }
      loadAccrualDue();
      loadAccruals();
    } catch (e: any) {
      flash(e?.message ?? 'Error', false);
    } finally {
      setBusyId(null);
    }
  };

  const handlePrepaidCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      description: prepaidForm.description,
      total_amount: parseFloat(prepaidForm.total_amount) || 0,
      start_date: prepaidForm.start_date,
      end_date: prepaidForm.end_date,
      amortization_periods: parseInt(prepaidForm.amortization_periods) || 12,
      notes: prepaidForm.notes || undefined,
    };
    try {
      const res: any = await api.featPrepaidCreate(payload);
      if (res?.error) { flash(res.error, false); return; }
      flash(`Prepaid schedule created. Period amount: ${formatCurrency(res?.period_amount)}`, true);
      setPrepaidForm({ description: '', total_amount: '', start_date: '', end_date: '', amortization_periods: '12', notes: '' });
      setShowPrepaidForm(false);
      loadPrepaids();
      loadPrepaidDue();
    } catch (e: any) {
      flash(e?.message ?? 'Error', false);
    }
  };

  const handleAccrualCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      description: accrualForm.description,
      amount: parseFloat(accrualForm.amount) || 0,
      accrual_date: accrualForm.accrual_date,
      reverse_date: accrualForm.reverse_date || undefined,
      accrual_type: accrualForm.accrual_type,
      notes: accrualForm.notes || undefined,
    };
    try {
      const res: any = await api.featAccrualCreate(payload);
      if (res?.error) { flash(res.error, false); return; }
      flash('Accrual entry created.', true);
      setAccrualForm({ description: '', amount: '', accrual_date: '', reverse_date: '', accrual_type: 'expense', notes: '' });
      setShowAccrualForm(false);
      loadAccruals();
    } catch (e: any) {
      flash(e?.message ?? 'Error', false);
    }
  };

  const handleCommCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      commission_amount: parseFloat(commForm.commission_amount) || 0,
      amortization_period_months: parseInt(commForm.amortization_period_months) || 36,
      start_date: commForm.start_date || undefined,
      notes: commForm.notes || undefined,
    };
    try {
      const res: any = await api.featCommDeferCreate(payload);
      if (res?.error) { flash(res.error, false); return; }
      flash(`Commission deferral created. Period amount: ${formatCurrency(res?.period_amount)}`, true);
      setCommForm({ commission_amount: '', amortization_period_months: '36', start_date: '', notes: '' });
      setShowCommForm(false);
      loadComm();
    } catch (e: any) {
      flash(e?.message ?? 'Error', false);
    }
  };

  return (
    <div className="space-y-4">
      {msg && (
        <div className={`flex items-center gap-2 px-3 py-2 text-xs border ${msg.ok ? 'border-accent-income text-accent-income' : 'border-accent-expense text-accent-expense'}`}
          style={{ borderRadius: 'var(--app-radius)' }}>
          {msg.ok ? <CheckCircle size={13} /> : <AlertCircle size={13} />}
          {msg.text}
        </div>
      )}

      {/* Prepaid Due */}
      <div>
        <SectionHeader
          title="Prepaid Amortization Due"
          count={prepaidDue.length}
          expanded={prepaidDueExpanded}
          onToggle={() => setPrepaidDueExpanded(v => !v)}
        />
        {prepaidDueExpanded && (
          <div className="mt-1">
            {loadingPrepaidDue
              ? <div className="text-text-muted text-xs py-3 px-2">Loading…</div>
              : prepaidDue.length === 0
                ? <EmptyState message="No prepaid amortizations due." />
                : (
                  <table className="block-table w-full text-xs">
                    <thead>
                      <tr>
                        <th className="text-left">Description</th>
                        <th className="text-right">Period Amount</th>
                        <th className="text-left">Next Recognition</th>
                        <th className="text-right">Periods Left</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {prepaidDue.map((item: any) => (
                        <tr key={item.id}>
                          <td className="text-text-primary">{item.description}</td>
                          <td className="text-right font-mono text-accent-expense">{formatCurrency(item.period_amount)}</td>
                          <td>{formatDate(item.next_recognition_date)}</td>
                          <td className="text-right">{(item.amortization_periods ?? 0) - (item.periods_recognized ?? 0)}</td>
                          <td className="text-right">
                            <button
                              className="block-btn text-xs"
                              disabled={busyId === item.id}
                              onClick={() => handlePrepaidRecognize(item)}
                            >
                              {busyId === item.id ? 'Posting…' : 'Recognize'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
          </div>
        )}
      </div>

      {/* All Prepaid Schedules */}
      <div>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <SectionHeader
              title="Prepaid Schedules"
              count={prepaids.length}
              expanded={prepaidsExpanded}
              onToggle={() => setPrepaidsExpanded(v => !v)}
            />
          </div>
          <button
            className="block-btn text-xs flex items-center gap-1"
            onClick={() => setShowPrepaidForm(v => !v)}
          >
            <Plus size={12} /> New Prepaid
          </button>
          <button className="block-btn text-xs" title="Refresh" onClick={loadPrepaids}>
            <RefreshCw size={12} className={loadingPrepaids ? 'animate-spin' : ''} />
          </button>
        </div>

        {showPrepaidForm && (
          <form onSubmit={handlePrepaidCreate} className="block-card mt-2 space-y-3" style={{ padding: 16 }}>
            <div className="text-xs font-bold uppercase text-text-secondary mb-2">New Prepaid Schedule</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs text-text-muted mb-1">Description *</label>
                <input
                  className="block-input w-full text-xs"
                  required
                  value={prepaidForm.description}
                  onChange={e => setPrepaidForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="e.g. Annual insurance premium"
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Total Amount *</label>
                <input
                  type="number"
                  step="0.01"
                  className="block-input w-full text-xs"
                  required
                  value={prepaidForm.total_amount}
                  onChange={e => setPrepaidForm(f => ({ ...f, total_amount: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Amortization Periods</label>
                <input
                  type="number"
                  min="1"
                  className="block-input w-full text-xs"
                  value={prepaidForm.amortization_periods}
                  onChange={e => setPrepaidForm(f => ({ ...f, amortization_periods: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Start Date *</label>
                <input
                  type="date"
                  className="block-input w-full text-xs"
                  required
                  value={prepaidForm.start_date}
                  onChange={e => setPrepaidForm(f => ({ ...f, start_date: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">End Date *</label>
                <input
                  type="date"
                  className="block-input w-full text-xs"
                  required
                  value={prepaidForm.end_date}
                  onChange={e => setPrepaidForm(f => ({ ...f, end_date: e.target.value }))}
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-text-muted mb-1">Notes</label>
                <input
                  className="block-input w-full text-xs"
                  value={prepaidForm.notes}
                  onChange={e => setPrepaidForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" className="block-btn text-xs" onClick={() => setShowPrepaidForm(false)}>Cancel</button>
              <button type="submit" className="block-btn block-btn-primary text-xs">Create</button>
            </div>
          </form>
        )}

        {prepaidsExpanded && (
          <div className="mt-1">
            {loadingPrepaids
              ? <div className="text-text-muted text-xs py-3 px-2">Loading…</div>
              : prepaids.length === 0
                ? <EmptyState message="No prepaid schedules found." />
                : (
                  <table className="block-table w-full text-xs">
                    <thead>
                      <tr>
                        <th className="text-left">Description</th>
                        <th className="text-right">Total</th>
                        <th className="text-right">Period Amt</th>
                        <th className="text-left">Start</th>
                        <th className="text-left">Next</th>
                        <th className="text-right">Rec.</th>
                        <th className="text-right">Periods</th>
                        <th className="text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prepaids.map((s: any) => (
                        <tr key={s.id}>
                          <td className="text-text-primary">{s.description}</td>
                          <td className="text-right font-mono">{formatCurrency(s.total_amount)}</td>
                          <td className="text-right font-mono text-accent-expense">{formatCurrency(s.period_amount)}</td>
                          <td>{formatDate(s.start_date)}</td>
                          <td>{formatDate(s.next_recognition_date)}</td>
                          <td className="text-right">{s.periods_recognized ?? 0}</td>
                          <td className="text-right">{s.amortization_periods}</td>
                          <td><StatusBadge status={s.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
          </div>
        )}
      </div>

      {/* Accruals Due for Reversal */}
      <div>
        <SectionHeader
          title="Accrual Reversals Due"
          count={accrualDue.length}
          expanded={accrualDueExpanded}
          onToggle={() => setAccrualDueExpanded(v => !v)}
        />
        {accrualDueExpanded && (
          <div className="mt-1">
            {loadingAccrualDue
              ? <div className="text-text-muted text-xs py-3 px-2">Loading…</div>
              : accrualDue.length === 0
                ? <EmptyState message="No accrual reversals due." />
                : (
                  <table className="block-table w-full text-xs">
                    <thead>
                      <tr>
                        <th className="text-left">Description</th>
                        <th className="text-right">Amount</th>
                        <th className="text-left">Accrual Date</th>
                        <th className="text-left">Reverse Date</th>
                        <th className="text-left">Type</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {accrualDue.map((item: any) => (
                        <tr key={item.id}>
                          <td className="text-text-primary">{item.description}</td>
                          <td className="text-right font-mono text-accent-expense">{formatCurrency(item.amount)}</td>
                          <td>{formatDate(item.accrual_date)}</td>
                          <td>{formatDate(item.reverse_date)}</td>
                          <td>{humanizeLabel(item.accrual_type)}</td>
                          <td className="text-right">
                            <button
                              className="block-btn text-xs"
                              disabled={busyId === item.id}
                              onClick={() => handleAccrualMarkReversed(item)}
                            >
                              {busyId === item.id ? 'Marking…' : 'Mark Reversed'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
          </div>
        )}
      </div>

      {/* All Accruals */}
      <div>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <SectionHeader
              title="Accrual Entries"
              count={accruals.length}
              expanded={accrualsExpanded}
              onToggle={() => setAccrualsExpanded(v => !v)}
            />
          </div>
          <button
            className="block-btn text-xs flex items-center gap-1"
            onClick={() => setShowAccrualForm(v => !v)}
          >
            <Plus size={12} /> New Accrual
          </button>
          <button className="block-btn text-xs" title="Refresh" onClick={loadAccruals}>
            <RefreshCw size={12} className={loadingAccruals ? 'animate-spin' : ''} />
          </button>
        </div>

        {showAccrualForm && (
          <form onSubmit={handleAccrualCreate} className="block-card mt-2 space-y-3" style={{ padding: 16 }}>
            <div className="text-xs font-bold uppercase text-text-secondary mb-2">New Accrual Entry</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs text-text-muted mb-1">Description *</label>
                <input
                  className="block-input w-full text-xs"
                  required
                  value={accrualForm.description}
                  onChange={e => setAccrualForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="e.g. Month-end interest accrual"
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Amount *</label>
                <input
                  type="number"
                  step="0.01"
                  className="block-input w-full text-xs"
                  required
                  value={accrualForm.amount}
                  onChange={e => setAccrualForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Type</label>
                <select
                  className="block-input w-full text-xs"
                  value={accrualForm.accrual_type}
                  onChange={e => setAccrualForm(f => ({ ...f, accrual_type: e.target.value }))}
                >
                  <option value="expense">Expense</option>
                  <option value="revenue">Revenue</option>
                  <option value="interest">Interest</option>
                  <option value="bank_fee">Bank Fee</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Accrual Date *</label>
                <input
                  type="date"
                  className="block-input w-full text-xs"
                  required
                  value={accrualForm.accrual_date}
                  onChange={e => setAccrualForm(f => ({ ...f, accrual_date: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Reverse Date</label>
                <input
                  type="date"
                  className="block-input w-full text-xs"
                  value={accrualForm.reverse_date}
                  onChange={e => setAccrualForm(f => ({ ...f, reverse_date: e.target.value }))}
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-text-muted mb-1">Notes</label>
                <input
                  className="block-input w-full text-xs"
                  value={accrualForm.notes}
                  onChange={e => setAccrualForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" className="block-btn text-xs" onClick={() => setShowAccrualForm(false)}>Cancel</button>
              <button type="submit" className="block-btn block-btn-primary text-xs">Create</button>
            </div>
          </form>
        )}

        {accrualsExpanded && (
          <div className="mt-1">
            {loadingAccruals
              ? <div className="text-text-muted text-xs py-3 px-2">Loading…</div>
              : accruals.length === 0
                ? <EmptyState message="No accrual entries found." />
                : (
                  <table className="block-table w-full text-xs">
                    <thead>
                      <tr>
                        <th className="text-left">Description</th>
                        <th className="text-right">Amount</th>
                        <th className="text-left">Date</th>
                        <th className="text-left">Reverse</th>
                        <th className="text-left">Type</th>
                        <th className="text-left">Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {accruals.map((a: any) => (
                        <tr key={a.id}>
                          <td className="text-text-primary">{a.description}</td>
                          <td className="text-right font-mono">{formatCurrency(a.amount)}</td>
                          <td>{formatDate(a.accrual_date)}</td>
                          <td>{formatDate(a.reverse_date)}</td>
                          <td>{humanizeLabel(a.accrual_type)}</td>
                          <td><StatusBadge status={a.status} /></td>
                          <td className="text-right">
                            {a.status === 'draft' && (
                              <button
                                className="block-btn text-xs"
                                disabled={busyId === a.id}
                                onClick={() => handleAccrualPost(a)}
                              >
                                {busyId === a.id ? 'Posting…' : 'Post'}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
          </div>
        )}
      </div>

      {/* Commission Deferrals */}
      <div>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <SectionHeader
              title="Commission Deferrals (ASC 340-40)"
              count={commDeferrals.length}
              expanded={commExpanded}
              onToggle={() => setCommExpanded(v => !v)}
            />
          </div>
          <button
            className="block-btn text-xs flex items-center gap-1"
            onClick={() => setShowCommForm(v => !v)}
          >
            <Plus size={12} /> Defer Commission
          </button>
          <button className="block-btn text-xs" title="Refresh" onClick={loadComm}>
            <RefreshCw size={12} className={loadingComm ? 'animate-spin' : ''} />
          </button>
        </div>

        {showCommForm && (
          <form onSubmit={handleCommCreate} className="block-card mt-2 space-y-3" style={{ padding: 16 }}>
            <div className="text-xs font-bold uppercase text-text-secondary mb-2">New Commission Deferral</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">Commission Amount *</label>
                <input
                  type="number"
                  step="0.01"
                  className="block-input w-full text-xs"
                  required
                  value={commForm.commission_amount}
                  onChange={e => setCommForm(f => ({ ...f, commission_amount: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Amortization (months)</label>
                <input
                  type="number"
                  min="1"
                  className="block-input w-full text-xs"
                  value={commForm.amortization_period_months}
                  onChange={e => setCommForm(f => ({ ...f, amortization_period_months: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Start Date</label>
                <input
                  type="date"
                  className="block-input w-full text-xs"
                  value={commForm.start_date}
                  onChange={e => setCommForm(f => ({ ...f, start_date: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Notes</label>
                <input
                  className="block-input w-full text-xs"
                  value={commForm.notes}
                  onChange={e => setCommForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" className="block-btn text-xs" onClick={() => setShowCommForm(false)}>Cancel</button>
              <button type="submit" className="block-btn block-btn-primary text-xs">Create</button>
            </div>
          </form>
        )}

        {commExpanded && (
          <div className="mt-1">
            {loadingComm
              ? <div className="text-text-muted text-xs py-3 px-2">Loading…</div>
              : commDeferrals.length === 0
                ? <EmptyState message="No commission deferrals found." />
                : (
                  <table className="block-table w-full text-xs">
                    <thead>
                      <tr>
                        <th className="text-right">Commission</th>
                        <th className="text-right">Capitalized</th>
                        <th className="text-right">Period Amt</th>
                        <th className="text-right">Amortized</th>
                        <th className="text-left">Start</th>
                        <th className="text-right">Months</th>
                        <th className="text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {commDeferrals.map((c: any) => (
                        <tr key={c.id}>
                          <td className="text-right font-mono">{formatCurrency(c.commission_amount)}</td>
                          <td className="text-right font-mono">{formatCurrency(c.capitalized_amount)}</td>
                          <td className="text-right font-mono text-accent-expense">{formatCurrency(c.period_amount)}</td>
                          <td className="text-right font-mono">{formatCurrency(c.amortized_to_date)}</td>
                          <td>{formatDate(c.start_date)}</td>
                          <td className="text-right">{c.amortization_period_months}</td>
                          <td><StatusBadge status={c.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Main SchedulesPanel ──────────────────────────────────
const SchedulesPanel: React.FC = () => {
  const [subTab, setSubTab] = useState<SubTab>('revenue');

  const subTabs: { id: SubTab; label: string }[] = [
    { id: 'revenue', label: 'Revenue Recognition (ASC 606)' },
    { id: 'prepaid-accrual', label: 'Prepaid & Accruals' },
  ];

  return (
    <div className="space-y-4">
      {/* Sub-tab nav */}
      <div className="flex gap-1 border-b border-border-primary">
        {subTabs.map(st => (
          <button
            key={st.id}
            onClick={() => setSubTab(st.id)}
            className={`px-4 py-2 text-xs font-semibold transition-colors border-b-2 -mb-px ${
              subTab === st.id
                ? 'border-b-accent-blue text-text-primary'
                : 'border-b-transparent text-text-muted hover:text-text-secondary'
            }`}
          >
            {st.label}
          </button>
        ))}
      </div>

      {subTab === 'revenue' && <RevenueSub />}
      {subTab === 'prepaid-accrual' && <PrepaidAccrualSub />}
    </div>
  );
};

export default SchedulesPanel;
