// src/renderer/modules/subscriptions/MetricsTab.tsx
//
// Feature #29 — MRR / ARR + churn dashboard.
// Uses: featMrrCalc (feat:mrr:calc), iwMetricsMrr (iw:metrics:mrr),
//       featChurnCalc (feat:churn:calc), iwChurnPredict (iw:churn:predict per client).

import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import { Section, Empty, StatCard, Th, Td, TOK } from './shared/ui';

const MetricsTab: React.FC = () => {
  const [mrrFeat, setMrrFeat] = useState<any>(null);
  const [mrrIw, setMrrIw] = useState<any>(null);
  const [churn, setChurn] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Churn calc period: last 30 days
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const quiet = () => {};

    api.featMrrCalc()
      .then((r: any) => { if (!cancelled && r && !r.error) setMrrFeat(r); })
      .catch(quiet);

    api.iwMetricsMrr()
      .then((r: any) => { if (!cancelled && r && !r.error) setMrrIw(r); })
      .catch(quiet);

    api.featChurnCalc(thirtyDaysAgo, today)
      .then((r: any) => { if (!cancelled && r && !r.error) setChurn(r); })
      .catch(quiet)
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, []);

  // Prefer iwMetricsMrr as primary (it includes recurring templates), fall back to featMrrCalc
  const mrr = mrrIw?.mrr ?? mrrFeat?.mrr ?? null;
  const arr = mrrIw?.arr ?? (mrr !== null ? mrr * 12 : null);
  const activeSubs = mrrIw?.active_subscriptions ?? null;
  const churned30d = mrrIw?.churned_30d ?? null;
  const churnRatePct = mrrIw?.churn_rate_pct ?? churn?.churn_rate ?? null;
  const mrrLost = churn?.mrr_lost ?? null;
  const customersLost = churn?.customers_lost ?? null;

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="MRR"
          value={loading ? '…' : mrr !== null ? formatCurrency(mrr) : '—'}
          sub="Monthly Recurring Revenue"
          color={TOK.income}
        />
        <StatCard
          label="ARR"
          value={loading ? '…' : arr !== null ? formatCurrency(arr) : '—'}
          sub="Annual Recurring Revenue"
          color={TOK.brand}
        />
        <StatCard
          label="Active Subscriptions"
          value={loading ? '…' : activeSubs !== null ? activeSubs : '—'}
          sub={churned30d !== null ? `${churned30d} churned last 30d` : undefined}
        />
        <StatCard
          label="Churn Rate (30d)"
          value={loading ? '…' : churnRatePct !== null ? `${churnRatePct}%` : '—'}
          sub={mrrLost !== null ? `${formatCurrency(mrrLost)} MRR lost` : undefined}
          color={churnRatePct !== null && churnRatePct > 5 ? TOK.expense : churnRatePct !== null ? TOK.income : undefined}
        />
      </div>

      {/* Churn detail */}
      <Section
        title="Churn Detail (last 30 days)"
        icon={<TrendingDown size={13} style={{ color: TOK.expense }} />}
      >
        {loading ? (
          <div className="px-4 py-3 text-[11px] text-text-muted">Loading…</div>
        ) : !churn && !mrrIw ? (
          <Empty msg="No churn data available. Ensure subscriptions are configured." />
        ) : (
          <div className="p-4 space-y-2">
            <div className="grid grid-cols-3 gap-4">
              <div className="block-card p-3">
                <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">Customers Lost</div>
                <div className="text-base font-bold font-mono mt-1" style={{ color: customersLost ? TOK.expense : 'var(--color-text-primary)' }}>
                  {customersLost ?? '—'}
                </div>
              </div>
              <div className="block-card p-3">
                <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">MRR Lost</div>
                <div className="text-base font-bold font-mono mt-1" style={{ color: mrrLost && mrrLost > 0 ? TOK.expense : 'var(--color-text-primary)' }}>
                  {mrrLost !== null ? formatCurrency(mrrLost) : '—'}
                </div>
              </div>
              <div className="block-card p-3">
                <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">Churn Rate</div>
                <div className="text-base font-bold font-mono mt-1" style={{ color: churnRatePct !== null && churnRatePct > 5 ? TOK.expense : churnRatePct !== null && churnRatePct === 0 ? TOK.income : 'var(--color-text-primary)' }}>
                  {churnRatePct !== null ? `${churnRatePct}%` : '—'}
                </div>
              </div>
            </div>

            <div className="text-[10px] text-text-muted pt-1">
              Period: {thirtyDaysAgo} → {today}
            </div>
          </div>
        )}
      </Section>

      {/* Revenue metrics breakdown */}
      <Section
        title="Revenue Metrics Breakdown"
        icon={<TrendingUp size={13} style={{ color: TOK.income }} />}
      >
        <div className="p-4">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${TOK.border}` }}>
                <Th>Metric</Th>
                <Th right>Value</Th>
                <Th>Source</Th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: `1px solid ${TOK.border}` }}>
                <Td>MRR (iw:metrics)</Td>
                <Td right mono>{mrrIw?.mrr !== undefined ? formatCurrency(mrrIw.mrr) : '—'}</Td>
                <Td>Subscriptions + recurring templates</Td>
              </tr>
              <tr style={{ borderBottom: `1px solid ${TOK.border}` }}>
                <Td>MRR (feat:mrr:calc)</Td>
                <Td right mono>{mrrFeat?.mrr !== undefined ? formatCurrency(mrrFeat.mrr) : '—'}</Td>
                <Td>Subscription plans snapshot</Td>
              </tr>
              <tr style={{ borderBottom: `1px solid ${TOK.border}` }}>
                <Td>ARR</Td>
                <Td right mono>{arr !== null ? formatCurrency(arr) : '—'}</Td>
                <Td>MRR × 12</Td>
              </tr>
              <tr>
                <Td>Active Subscriptions</Td>
                <Td right mono>{activeSubs ?? '—'}</Td>
                <Td>Current period</Td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
};

export default MetricsTab;
