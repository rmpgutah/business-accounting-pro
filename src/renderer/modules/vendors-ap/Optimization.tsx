// src/renderer/modules/vendors-ap/Optimization.tsx
//
// Optimization tab — surfaces actionable cost & contract intelligence:
//   • KPI strip: off-contract spend, est. annual subscription commitment,
//     vendors with price drift, contracts expiring ≤60d
//   • Sections: Off-Contract Spend · Price Drift · Subscriptions · Contract Renewals
//
// All tokens via TOK / CSS vars — NO hex.

import React, { useEffect, useState } from 'react';
import { AlertTriangle, TrendingUp, RefreshCw, Calendar } from 'lucide-react';
import api from '../../lib/api';
import { Section, Empty, Th, Td, StatCard, TOK } from './shared/ui';

interface Props {
  onViewVendor?: (id: string) => void;
}

// ── Shape types inferred from service implementations ────────────

interface OffContractRow {
  vendor_id: string;
  name: string;
  approval_status: string;
  total_spend: number;
  reason: string;
}

interface PriceVarianceRow {
  vendor_id: string;
  vendor_name: string;
  description: string;
  occurrences: number;
  min_price: number;
  avg_price: number;
  max_price: number;
  variance_pct: number;
}

interface RecurringRow {
  vendor_id: string;
  description: string;
  avg_amount: number;
  occurrences: number;
  first_seen: string;
  last_seen: string;
  avg_days_apart: number;
}

interface ExpiringContractRow {
  id: string;
  name: string;
  contract_start_date: string | null;
  contract_end_date: string;
  contract_auto_renew: number | null;
  contract_renewal_notice_days: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────

const fmt = (n: number) =>
  '$' + (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const fmtDec = (n: number) =>
  '$' + (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Estimate monthly from avg_days_apart: (30.4 / avg_days_apart) * avg_amount
function estMonthly(row: RecurringRow): number {
  if (!row.avg_days_apart || row.avg_days_apart <= 0) return 0;
  return (30.4 / row.avg_days_apart) * row.avg_amount;
}

function estAnnual(row: RecurringRow): number {
  return estMonthly(row) * 12;
}

function daysUntil(dateStr: string): number {
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / 86_400_000);
}

// ── Optimization component ────────────────────────────────────────

const Optimization: React.FC<Props> = ({ onViewVendor }) => {
  const [offContract, setOffContract] = useState<OffContractRow[]>([]);
  const [priceVariance, setPriceVariance] = useState<PriceVarianceRow[]>([]);
  const [recurring, setRecurring] = useState<RecurringRow[]>([]);
  const [expiring, setExpiring] = useState<ExpiringContractRow[]>([]);

  const [loadingOC, setLoadingOC] = useState(true);
  const [loadingPV, setLoadingPV] = useState(true);
  const [loadingRec, setLoadingRec] = useState(true);
  const [loadingExp, setLoadingExp] = useState(true);

  // ── Independent loads with cancellation guards ────────────────
  useEffect(() => {
    let cancelled = false;
    setLoadingOC(true);
    api.vnOffContractSpend().then((rows: any) => {
      if (!cancelled) { setOffContract(Array.isArray(rows) ? rows : []); setLoadingOC(false); }
    }).catch(() => { if (!cancelled) setLoadingOC(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingPV(true);
    api.vnPriceVariance(3).then((rows: any) => {
      if (!cancelled) { setPriceVariance(Array.isArray(rows) ? rows : []); setLoadingPV(false); }
    }).catch(() => { if (!cancelled) setLoadingPV(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingRec(true);
    api.exDetectRecurring().then((rows: any) => {
      if (!cancelled) { setRecurring(Array.isArray(rows) ? rows : []); setLoadingRec(false); }
    }).catch(() => { if (!cancelled) setLoadingRec(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingExp(true);
    api.featVendorExpiringContracts(60).then((rows: any) => {
      if (!cancelled) { setExpiring(Array.isArray(rows) ? rows : []); setLoadingExp(false); }
    }).catch(() => { if (!cancelled) setLoadingExp(false); });
    return () => { cancelled = true; };
  }, []);

  // ── Derived KPIs ─────────────────────────────────────────────
  const totalOffContractSpend = offContract.reduce((s, r) => s + (r.total_spend || 0), 0);
  const totalAnnualSubscription = recurring.reduce((s, r) => s + estAnnual(r), 0);
  const vendorsWithDrift = priceVariance.length;
  const contractsExpiring60 = expiring.length;

  return (
    <div className="space-y-4">

      {/* ── KPI Strip ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <StatCard
          label="Off-Contract Spend"
          value={loadingOC ? '…' : fmt(totalOffContractSpend)}
          sub="Unapproved / expired contract"
          color={totalOffContractSpend > 0 ? TOK.expense : undefined}
        />
        <StatCard
          label="Est. Annual Subscriptions"
          value={loadingRec ? '…' : fmt(totalAnnualSubscription)}
          sub="Recurring charge annualized"
          color={TOK.warning}
        />
        <StatCard
          label="Vendors w/ Price Drift"
          value={loadingPV ? '…' : vendorsWithDrift}
          sub="≥3 occurrences, variance detected"
          color={vendorsWithDrift > 0 ? TOK.warning : undefined}
        />
        <StatCard
          label="Contracts Expiring ≤60d"
          value={loadingExp ? '…' : contractsExpiring60}
          sub="Needs renewal review"
          color={contractsExpiring60 > 0 ? TOK.expense : undefined}
        />
      </div>

      {/* ── Off-Contract Spend ────────────────────────────────── */}
      <Section
        title="Off-Contract Spend"
        icon={<AlertTriangle size={13} style={{ color: TOK.expense }} />}
        count={offContract.length}
      >
        {loadingOC ? (
          <Empty msg="Loading…" />
        ) : offContract.length === 0 ? (
          <Empty msg="No off-contract spend detected — all vendors are approved with active contracts." />
        ) : (
          <table className="block-table w-full">
            <thead>
              <tr>
                <Th>Vendor</Th>
                <Th>Reason</Th>
                <Th>Approval Status</Th>
                <Th right>Total Spend</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {offContract.map((row, i) => (
                <tr key={row.vendor_id ?? i}>
                  <Td>{row.name}</Td>
                  <Td>
                    <span style={{ color: TOK.expense, fontWeight: 600 }}>{row.reason}</span>
                  </Td>
                  <Td>{row.approval_status || 'None'}</Td>
                  <Td right mono color={TOK.expense}>{fmtDec(row.total_spend)}</Td>
                  <Td>
                    {onViewVendor && row.vendor_id ? (
                      <button
                        onClick={() => onViewVendor(row.vendor_id)}
                        className="text-[10px] font-medium px-2 py-0.5"
                        style={{
                          color: TOK.brand,
                          border: `1px solid ${TOK.brand}`,
                          borderRadius: 'var(--app-radius)',
                          background: 'transparent',
                        }}
                      >
                        View
                      </button>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ── Price Drift ───────────────────────────────────────── */}
      <Section
        title="Price Drift"
        icon={<TrendingUp size={13} style={{ color: TOK.warning }} />}
        count={priceVariance.length}
      >
        {loadingPV ? (
          <Empty msg="Loading…" />
        ) : priceVariance.length === 0 ? (
          <Empty msg="No price variance detected — unit prices are consistent across purchases." />
        ) : (
          <table className="block-table w-full">
            <thead>
              <tr>
                <Th>Vendor</Th>
                <Th>Item / Description</Th>
                <Th right>Occurrences</Th>
                <Th right>Min Price</Th>
                <Th right>Avg Price</Th>
                <Th right>Max Price</Th>
                <Th right>Variance %</Th>
              </tr>
            </thead>
            <tbody>
              {priceVariance.map((row, i) => {
                const varColor = row.variance_pct >= 50 ? TOK.expense : TOK.warning;
                return (
                  <tr key={`${row.vendor_id}-${i}`}>
                    <Td>{row.vendor_name}</Td>
                    <Td>{row.description}</Td>
                    <Td right mono>{row.occurrences}</Td>
                    <Td right mono>{fmtDec(row.min_price)}</Td>
                    <Td right mono>{fmtDec(row.avg_price)}</Td>
                    <Td right mono>{fmtDec(row.max_price)}</Td>
                    <Td right mono color={varColor}>
                      {(row.variance_pct ?? 0).toFixed(1)}%
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>

      {/* ── Subscriptions / Recurring ─────────────────────────── */}
      <Section
        title="Subscriptions & Recurring Charges"
        icon={<RefreshCw size={13} style={{ color: TOK.blue }} />}
        count={recurring.length}
        right={
          recurring.length > 0 ? (
            <span className="text-[10px] font-mono" style={{ color: TOK.warning }}>
              Total annual: {fmt(totalAnnualSubscription)}
            </span>
          ) : undefined
        }
      >
        {loadingRec ? (
          <Empty msg="Loading…" />
        ) : recurring.length === 0 ? (
          <Empty msg="No recurring charge patterns detected yet — needs ≥3 similar transactions." />
        ) : (
          <table className="block-table w-full">
            <thead>
              <tr>
                <Th>Description</Th>
                <Th right>Avg Charge</Th>
                <Th right>Interval (days)</Th>
                <Th right>Est. Monthly</Th>
                <Th right>Est. Annual</Th>
                <Th right>Occurrences</Th>
              </tr>
            </thead>
            <tbody>
              {recurring.map((row, i) => (
                <tr key={`${row.vendor_id}-${i}`}>
                  <Td>{row.description || '—'}</Td>
                  <Td right mono>{fmtDec(row.avg_amount)}</Td>
                  <Td right mono>{row.avg_days_apart ?? '—'}</Td>
                  <Td right mono>{fmtDec(estMonthly(row))}</Td>
                  <Td right mono color={TOK.warning}>{fmtDec(estAnnual(row))}</Td>
                  <Td right mono>{row.occurrences}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ── Contract Renewals ─────────────────────────────────── */}
      <Section
        title="Contract Renewals Due ≤60 Days"
        icon={<Calendar size={13} style={{ color: TOK.blue }} />}
        count={expiring.length}
      >
        {loadingExp ? (
          <Empty msg="Loading…" />
        ) : expiring.length === 0 ? (
          <Empty msg="No contracts expiring within 60 days." />
        ) : (
          <table className="block-table w-full">
            <thead>
              <tr>
                <Th>Vendor</Th>
                <Th>Contract End</Th>
                <Th right>Days Left</Th>
                <Th>Auto-Renew</Th>
                <Th right>Notice Days</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {expiring.map((row) => {
                const days = daysUntil(row.contract_end_date);
                const urgentColor = days <= 14 ? TOK.expense : TOK.warning;
                const autoRenew = row.contract_auto_renew === 1 || row.contract_auto_renew === true as any;
                return (
                  <tr key={row.id}>
                    <Td>{row.name}</Td>
                    <Td mono>{row.contract_end_date}</Td>
                    <Td right mono color={urgentColor}>{days}</Td>
                    <Td>
                      <span style={{ color: autoRenew ? TOK.income : TOK.expense, fontWeight: 600 }}>
                        {autoRenew ? 'Yes' : 'No'}
                      </span>
                    </Td>
                    <Td right mono>
                      {row.contract_renewal_notice_days != null ? row.contract_renewal_notice_days : '—'}
                    </Td>
                    <Td>
                      {onViewVendor && row.id ? (
                        <button
                          onClick={() => onViewVendor(row.id)}
                          className="text-[10px] font-medium px-2 py-0.5"
                          style={{
                            color: TOK.brand,
                            border: `1px solid ${TOK.brand}`,
                            borderRadius: 'var(--app-radius)',
                            background: 'transparent',
                          }}
                        >
                          View
                        </button>
                      ) : null}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>

    </div>
  );
};

export default Optimization;
