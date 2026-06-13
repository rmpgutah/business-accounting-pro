// src/renderer/modules/subscriptions/ProrationTab.tsx
//
// Feature #30 — Proration & auto-renew controls + expiring trials.
// Uses: iwProration, iwSubAutoRenew, iwTrialsExpiring.

import React, { useEffect, useState } from 'react';
import { Clock, ToggleLeft, ToggleRight, Calculator } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import { Section, Empty, Th, Td, TOK } from './shared/ui';

const BLANK_PROR = { current_amount: '', new_amount: '', cycle_days_remaining: '', total_cycle_days: '' };

const ProrationTab: React.FC = () => {
  const [trials, setTrials] = useState<any[]>([]);
  const [loadingTrials, setLoadingTrials] = useState(true);
  const [prorationForm, setProrationForm] = useState<typeof BLANK_PROR>({ ...BLANK_PROR });
  const [prorationResult, setProrationResult] = useState<any>(null);
  const [prorationErr, setProrationErr] = useState('');
  const [calcBusy, setCalcBusy] = useState(false);
  // Toggle state per subscription id
  const [toggling, setToggling] = useState<Record<string, boolean>>({});
  const [toggleResult, setToggleResult] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    setLoadingTrials(true);
    // Fetch trials expiring in next 14 days
    api.iwTrialsExpiring(14)
      .then((r: any) => {
        if (!cancelled && Array.isArray(r)) setTrials(r);
        if (!cancelled) setLoadingTrials(false);
      })
      .catch(() => { if (!cancelled) setLoadingTrials(false); });
    return () => { cancelled = true; };
  }, []);

  const handleProrationCalc = async () => {
    const ca = parseFloat(prorationForm.current_amount);
    const na = parseFloat(prorationForm.new_amount);
    const cr = parseInt(prorationForm.cycle_days_remaining, 10);
    const tc = parseInt(prorationForm.total_cycle_days, 10);
    if (isNaN(ca) || isNaN(na) || isNaN(cr) || isNaN(tc)) {
      setProrationErr('All four fields are required numeric values.');
      return;
    }
    setCalcBusy(true); setProrationErr(''); setProrationResult(null);
    try {
      const res = await api.iwProration({ current_amount: ca, new_amount: na, cycle_days_remaining: cr, total_cycle_days: tc });
      if (res?.error) setProrationErr(res.error);
      else setProrationResult(res);
    } catch (e: any) { setProrationErr(e?.message || 'Error'); }
    finally { setCalcBusy(false); }
  };

  const handleAutoRenewToggle = async (subId: string, currentValue: boolean) => {
    setToggling((t) => ({ ...t, [subId]: true }));
    try {
      const res = await api.iwSubAutoRenew(subId, !currentValue);
      if (res?.error) setToggleResult((r) => ({ ...r, [subId]: res.error }));
      else setToggleResult((r) => ({ ...r, [subId]: `Auto-renew set to ${!currentValue ? 'ON' : 'OFF'}` }));
    } catch (e: any) { setToggleResult((r) => ({ ...r, [subId]: e?.message || 'Error' })); }
    finally { setToggling((t) => ({ ...t, [subId]: false })); }
  };

  return (
    <div className="space-y-4">
      {/* Expiring trials */}
      <Section
        title="Expiring Trials (next 14 days)"
        icon={<Clock size={13} style={{ color: TOK.warning }} />}
        count={trials.length}
      >
        {loadingTrials ? (
          <div className="px-4 py-3 text-[11px] text-text-muted">Loading…</div>
        ) : trials.length === 0 ? (
          <Empty msg="No trials expiring in the next 14 days." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${TOK.border}` }}>
                  <Th>Subscription ID</Th>
                  <Th>Client</Th>
                  <Th>Trial Ends</Th>
                  <Th>Status</Th>
                  <Th>Auto-Renew</Th>
                  <Th>Toggle</Th>
                </tr>
              </thead>
              <tbody>
                {trials.map((t: any) => (
                  <tr key={t.id} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td mono>{(t.id || '').slice(0, 8)}…</Td>
                    <Td>{t.client_name || t.customer_id || '—'}</Td>
                    <Td color={TOK.warning}>{t.trial_end ? formatDate(t.trial_end) : t.trial_end_date ? formatDate(t.trial_end_date) : '—'}</Td>
                    <Td>{t.status || '—'}</Td>
                    <Td>
                      <span style={{ color: t.auto_renew ? TOK.income : TOK.muted }}>
                        {t.auto_renew ? 'ON' : 'OFF'}
                      </span>
                    </Td>
                    <Td>
                      <button
                        title={t.auto_renew ? 'Disable auto-renew' : 'Enable auto-renew'}
                        style={{ color: t.auto_renew ? TOK.income : TOK.muted }}
                        onClick={() => handleAutoRenewToggle(t.id, !!t.auto_renew)}
                        disabled={!!toggling[t.id]}
                      >
                        {t.auto_renew ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                      </button>
                      {toggleResult[t.id] && (
                        <span className="text-[10px] ml-1" style={{ color: TOK.blue }}>{toggleResult[t.id]}</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Auto-renew toggle for a known subscription */}
      <Section
        title="Auto-Renew: Toggle by Subscription ID"
        icon={<ToggleRight size={13} style={{ color: TOK.brand }} />}
      >
        <div className="p-4 space-y-3">
          <p className="text-[11px] text-text-muted">Enter a subscription ID and toggle its auto-renewal setting.</p>
          <AutoRenewControl />
        </div>
      </Section>

      {/* Proration calculator */}
      <Section
        title="Proration Calculator"
        icon={<Calculator size={13} style={{ color: TOK.blue }} />}
      >
        <div className="p-4 space-y-3">
          <p className="text-[11px] text-text-muted">Preview the proration credit/charge when switching a customer between plans mid-cycle.</p>
          {prorationErr && (
            <div className="text-[11px] px-2 py-1.5 rounded" style={{ background: 'color-mix(in srgb, var(--color-accent-expense) 12%, transparent)', color: TOK.expense }}>{prorationErr}</div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-text-muted mb-1">Current Amount ($)</label>
              <input className="block-input w-full text-xs" type="number" step="0.01" value={prorationForm.current_amount} onChange={(e) => setProrationForm({ ...prorationForm, current_amount: e.target.value })} />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-text-muted mb-1">New Amount ($)</label>
              <input className="block-input w-full text-xs" type="number" step="0.01" value={prorationForm.new_amount} onChange={(e) => setProrationForm({ ...prorationForm, new_amount: e.target.value })} />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-text-muted mb-1">Cycle Days Remaining</label>
              <input className="block-input w-full text-xs" type="number" min={0} value={prorationForm.cycle_days_remaining} onChange={(e) => setProrationForm({ ...prorationForm, cycle_days_remaining: e.target.value })} />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-text-muted mb-1">Total Cycle Days</label>
              <input className="block-input w-full text-xs" type="number" min={1} value={prorationForm.total_cycle_days} onChange={(e) => setProrationForm({ ...prorationForm, total_cycle_days: e.target.value })} />
            </div>
          </div>
          <button className="block-btn text-xs px-3 py-1.5" onClick={handleProrationCalc} disabled={calcBusy}>
            {calcBusy ? 'Calculating…' : 'Calculate Proration'}
          </button>
          {prorationResult && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
              <div className="block-card p-3">
                <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">Refund (unused)</div>
                <div className="text-base font-bold font-mono mt-1" style={{ color: TOK.income }}>{formatCurrency(prorationResult.refund_for_unused)}</div>
              </div>
              <div className="block-card p-3">
                <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">New Charge</div>
                <div className="text-base font-bold font-mono mt-1" style={{ color: TOK.expense }}>{formatCurrency(prorationResult.charge_for_new)}</div>
              </div>
              <div className="block-card p-3">
                <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">Net Proration</div>
                <div className="text-base font-bold font-mono mt-1" style={{ color: prorationResult.net_proration >= 0 ? TOK.expense : TOK.income }}>
                  {formatCurrency(prorationResult.net_proration)}
                </div>
              </div>
              <div className="block-card p-3">
                <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">Fraction Remaining</div>
                <div className="text-base font-bold font-mono mt-1">{(prorationResult.fraction_remaining * 100).toFixed(1)}%</div>
              </div>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
};

// Inline sub-component for toggling auto-renew by arbitrary subscription ID
const AutoRenewControl: React.FC = () => {
  const [subId, setSubId] = useState('');
  const [autoRenew, setAutoRenew] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const handle = async () => {
    if (!subId.trim()) { setMsg('Enter a subscription ID.'); return; }
    setBusy(true); setMsg('');
    try {
      const res = await api.iwSubAutoRenew(subId.trim(), autoRenew);
      if (res?.error) setMsg(`Error: ${res.error}`);
      else setMsg(`Auto-renew set to ${autoRenew ? 'ON' : 'OFF'} for ${subId.slice(0, 8)}…`);
    } catch (e: any) { setMsg(e?.message || 'Error'); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex items-end gap-3 flex-wrap">
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-text-muted mb-1">Subscription ID</label>
        <input className="block-input text-xs" style={{ width: 240 }} value={subId} onChange={(e) => setSubId(e.target.value)} placeholder="UUID…" />
      </div>
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-text-muted mb-1">Auto-Renew</label>
        <select className="block-input text-xs" value={autoRenew ? 'on' : 'off'} onChange={(e) => setAutoRenew(e.target.value === 'on')}>
          <option value="on">ON</option>
          <option value="off">OFF</option>
        </select>
      </div>
      <button className="block-btn text-xs px-3 py-1.5" onClick={handle} disabled={busy}>{busy ? 'Saving…' : 'Apply'}</button>
      {msg && <span className="text-[11px]" style={{ color: msg.startsWith('Error') ? TOK.expense : TOK.income }}>{msg}</span>}
    </div>
  );
};

export default ProrationTab;
