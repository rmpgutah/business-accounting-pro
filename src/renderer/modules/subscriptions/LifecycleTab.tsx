// src/renderer/modules/subscriptions/LifecycleTab.tsx
//
// Feature #28 — Subscription lifecycle console.
// List subscriptions (rawQuery JOIN subscription_plans + clients); create via featSubCreate;
// per-row Pause / Resume / Cancel / Change-Plan via feat:sub:* handlers.

import React, { useEffect, useState, useCallback } from 'react';
import { PlusCircle, Play, Pause, XCircle, RefreshCw } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import { Section, Empty, Th, Td, TOK, statusColor } from './shared/ui';

interface Plan { id: string; name: string; base_price: number; billing_frequency: string }
interface Sub {
  id: string;
  customer_id: string;
  plan_id: string;
  status: string;
  start_date: string;
  current_period_end: string;
  quantity: number;
  custom_price: number | null;
  notes: string | null;
  plan_name?: string;
  customer_name?: string;
}

const BLANK_FORM = { customer_id: '', plan_id: '', quantity: 1, custom_price: '', notes: '', start_date: '' };

const LifecycleTab: React.FC = () => {
  const [subs, setSubs] = useState<Sub[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<typeof BLANK_FORM>({ ...BLANK_FORM });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [reload, setReload] = useState(0);

  // Change-plan modal state
  const [changePlanFor, setChangePlanFor] = useState<string | null>(null);
  const [newPlanId, setNewPlanId] = useState('');
  const [changePlanResult, setChangePlanResult] = useState<any>(null);

  const refresh = useCallback(() => setReload((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr('');

    api.featSubPlanList()
      .then((r: any) => { if (!cancelled && Array.isArray(r)) setPlans(r); })
      .catch(() => {});

    api.rawQuery(
      `SELECT s.id, s.customer_id, s.plan_id, s.status, s.start_date,
              s.current_period_end, s.quantity, s.custom_price, s.notes,
              p.name AS plan_name,
              COALESCE(c.name, s.customer_id) AS customer_name
       FROM subscriptions s
       LEFT JOIN subscription_plans p ON p.id = s.plan_id
       LEFT JOIN clients c ON c.id = s.customer_id
       WHERE s.company_id = (SELECT id FROM companies LIMIT 1)
       ORDER BY s.created_at DESC
       LIMIT 200`
    )
      .then((r: any) => {
        if (!cancelled && Array.isArray(r)) setSubs(r);
        if (!cancelled) setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [reload]);

  const handleCreate = async () => {
    if (!form.customer_id.trim() || !form.plan_id) { setErr('Customer ID and plan are required.'); return; }
    setSaving(true); setErr('');
    try {
      const payload: any = {
        customer_id: form.customer_id.trim(),
        plan_id: form.plan_id,
        quantity: Number(form.quantity) || 1,
        notes: form.notes || undefined,
        start_date: form.start_date || undefined,
      };
      if (form.custom_price !== '') payload.custom_price = Number(form.custom_price);
      const res = await api.featSubCreate(payload);
      if (res?.error) { setErr(res.error); }
      else { setShowForm(false); setForm({ ...BLANK_FORM }); refresh(); }
    } catch (e: any) { setErr(e?.message || 'Error creating subscription.'); }
    finally { setSaving(false); }
  };

  const handlePause = async (id: string) => {
    if (!window.confirm('Pause this subscription?')) return;
    const res = await api.featSubPause(id);
    if (res?.error) alert(res.error);
    else refresh();
  };

  const handleResume = async (id: string) => {
    if (!window.confirm('Resume this subscription?')) return;
    const res = await api.featSubResume(id);
    if (res?.error) alert(res.error);
    else refresh();
  };

  const handleCancel = async (id: string) => {
    if (!window.confirm('Cancel this subscription? This cannot be undone.')) return;
    const atEnd = window.confirm('Cancel at period end? (OK = end of period, Cancel = immediately)');
    const res = await api.featSubCancel(id, atEnd);
    if (res?.error) alert(res.error);
    else refresh();
  };

  const openChangePlan = (id: string) => {
    setChangePlanFor(id);
    setNewPlanId('');
    setChangePlanResult(null);
  };

  const handleChangePlan = async () => {
    if (!changePlanFor || !newPlanId) return;
    const res = await api.featSubChangePlan(changePlanFor, newPlanId);
    if (res?.error) { alert(res.error); }
    else { setChangePlanResult(res); refresh(); }
  };

  return (
    <div className="space-y-4">
      {/* New Subscription form toggle */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-text-muted">Subscriptions</span>
        <button
          className="block-btn flex items-center gap-1.5 text-xs px-3 py-1.5"
          onClick={() => { setShowForm((v) => !v); setErr(''); }}
        >
          <PlusCircle size={13} /> New Subscription
        </button>
      </div>

      {showForm && (
        <div className="block-card p-4 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-text-muted mb-2">New Subscription</div>
          {err && <div className="text-[11px] px-2 py-1.5 rounded" style={{ background: 'color-mix(in srgb, var(--color-accent-expense) 12%, transparent)', color: TOK.expense }}>{err}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-text-muted mb-1">Customer ID *</label>
              <input className="block-input w-full text-xs" placeholder="client or customer ID" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })} />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-text-muted mb-1">Plan *</label>
              <select className="block-input w-full text-xs" value={form.plan_id} onChange={(e) => setForm({ ...form, plan_id: e.target.value })}>
                <option value="">Select plan…</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.billing_frequency}) — {formatCurrency(p.base_price)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-text-muted mb-1">Quantity</label>
              <input className="block-input w-full text-xs" type="number" min={1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-text-muted mb-1">Custom Price (override)</label>
              <input className="block-input w-full text-xs" type="number" step="0.01" placeholder="leave blank for plan default" value={form.custom_price} onChange={(e) => setForm({ ...form, custom_price: e.target.value })} />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-text-muted mb-1">Start Date</label>
              <input className="block-input w-full text-xs" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-text-muted mb-1">Notes</label>
              <input className="block-input w-full text-xs" placeholder="optional" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button className="block-btn text-xs px-3 py-1.5" onClick={handleCreate} disabled={saving}>{saving ? 'Saving…' : 'Create'}</button>
            <button className="text-xs px-3 py-1.5 text-text-muted" onClick={() => { setShowForm(false); setErr(''); }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Change-plan modal */}
      {changePlanFor && (
        <div className="block-card p-4 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-text-muted mb-2">Change Plan</div>
          {changePlanResult ? (
            <div className="space-y-1">
              <div className="text-[11px] text-text-primary">Plan changed. Proration: <span className="font-mono font-bold">{formatCurrency(changePlanResult.proration_amount)}</span></div>
              <div className="text-[11px] text-text-muted">New period end: {formatDate(changePlanResult.new_period_end)}</div>
              <button className="block-btn text-xs px-3 py-1.5 mt-2" onClick={() => setChangePlanFor(null)}>Close</button>
            </div>
          ) : (
            <>
              <select className="block-input w-full text-xs" value={newPlanId} onChange={(e) => setNewPlanId(e.target.value)}>
                <option value="">Select new plan…</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.billing_frequency}) — {formatCurrency(p.base_price)}</option>
                ))}
              </select>
              <div className="flex gap-2">
                <button className="block-btn text-xs px-3 py-1.5" onClick={handleChangePlan} disabled={!newPlanId}>Apply</button>
                <button className="text-xs px-3 py-1.5 text-text-muted" onClick={() => setChangePlanFor(null)}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Subscription list */}
      <Section title="All Subscriptions" count={subs.length}>
        {loading ? (
          <div className="px-4 py-3 text-[11px] text-text-muted">Loading…</div>
        ) : subs.length === 0 ? (
          <Empty msg="No subscriptions found. Create one above." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${TOK.border}` }}>
                  <Th>Customer</Th>
                  <Th>Plan</Th>
                  <Th>Status</Th>
                  <Th right>Qty</Th>
                  <Th>Period End</Th>
                  <Th>Start</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {subs.map((s) => (
                  <tr key={s.id} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td>{s.customer_name || s.customer_id || '—'}</Td>
                    <Td>{s.plan_name || s.plan_id || '—'}</Td>
                    <Td>
                      <span className="text-[10px] font-bold px-1.5 py-0.5" style={{ borderRadius: 4, color: statusColor(s.status), background: 'color-mix(in srgb, currentColor 12%, transparent)' }}>
                        {(s.status || 'unknown').toUpperCase()}
                      </span>
                    </Td>
                    <Td right mono>{s.quantity ?? 1}</Td>
                    <Td>{s.current_period_end ? formatDate(s.current_period_end) : '—'}</Td>
                    <Td>{s.start_date ? formatDate(s.start_date) : '—'}</Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        {s.status === 'active' && (
                          <button
                            title="Pause"
                            className="text-[10px] px-1.5 py-0.5 rounded"
                            style={{ color: TOK.warning, background: 'color-mix(in srgb, var(--color-accent-warning) 12%, transparent)' }}
                            onClick={() => handlePause(s.id)}
                          >
                            <Pause size={10} />
                          </button>
                        )}
                        {s.status === 'paused' && (
                          <button
                            title="Resume"
                            className="text-[10px] px-1.5 py-0.5 rounded"
                            style={{ color: TOK.income, background: 'color-mix(in srgb, var(--color-accent-income) 12%, transparent)' }}
                            onClick={() => handleResume(s.id)}
                          >
                            <Play size={10} />
                          </button>
                        )}
                        {(s.status === 'active' || s.status === 'trial' || s.status === 'paused') && (
                          <>
                            <button
                              title="Change Plan"
                              className="text-[10px] px-1.5 py-0.5 rounded"
                              style={{ color: TOK.blue, background: 'color-mix(in srgb, var(--color-accent-blue) 12%, transparent)' }}
                              onClick={() => openChangePlan(s.id)}
                            >
                              <RefreshCw size={10} />
                            </button>
                            <button
                              title="Cancel"
                              className="text-[10px] px-1.5 py-0.5 rounded"
                              style={{ color: TOK.expense, background: 'color-mix(in srgb, var(--color-accent-expense) 12%, transparent)' }}
                              onClick={() => handleCancel(s.id)}
                            >
                              <XCircle size={10} />
                            </button>
                          </>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
};

export default LifecycleTab;
