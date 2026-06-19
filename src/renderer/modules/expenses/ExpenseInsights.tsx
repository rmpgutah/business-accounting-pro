// src/renderer/modules/expenses/ExpenseInsights.tsx
//
// Expense Intelligence — the UI for the (previously dark) ex:* analytics
// backend. ~85 IPC handlers existed with zero renderer consumers; this tab
// surfaces them in six curated sections:
//   1. Health strip   — velocity, next-month forecast, expense:revenue,
//                       category concentration (HHI)
//   2. Hygiene        — duplicate pairs, missing receipts, uncategorized,
//                       pending-approval aging buckets
//   3. Subscriptions  — recurring same-vendor patterns with monthly +
//                       annualized cost estimates
//   4. Vendors        — per-vendor anomaly outliers (z-score), loyalty
//                       (frequency × recency × spend), largest expenses
//   5. People         — spend by employee, by payment method,
//                       reimbursement aging
//   6. Trends         — day-of-week pattern, month-over-month growth
//
// Every section loads independently (Promise per section, no Promise.all
// barrier) so one failed query never blanks the page.

import React, { useEffect, useState } from 'react';
import {
  Activity, Copy, ReceiptText, Repeat, Store, Users, TrendingUp, AlertTriangle,
} from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';

interface SectionProps { title: string; icon: React.ReactNode; count?: number; children: React.ReactNode }

const Section: React.FC<SectionProps> = ({ title, icon, count, children }) => (
  <div className="block-card p-0 overflow-hidden">
    <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid var(--color-border-primary)', background: 'var(--color-bg-secondary)' }}>
      {icon}
      <span className="text-xs font-bold uppercase tracking-wider text-text-muted">{title}</span>
      {count !== undefined && (
        <span className="text-[10px] font-bold px-1.5 py-0.5 ml-1" style={{ borderRadius: 4, background: 'rgba(96,165,250,0.12)', color: 'var(--color-accent-blue)' }}>{count}</span>
      )}
    </div>
    {children}
  </div>
);

const Empty: React.FC<{ msg: string }> = ({ msg }) => (
  <div className="px-4 py-3 text-[11px] text-text-muted">{msg}</div>
);

const Th: React.FC<{ children?: React.ReactNode; right?: boolean }> = ({ children, right }) => (
  <th style={{ padding: '5px 10px', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--color-text-muted)', textAlign: right ? 'right' : 'left' }}>{children}</th>
);
const Td: React.FC<{ children: React.ReactNode; right?: boolean; mono?: boolean; color?: string }> = ({ children, right, mono, color }) => (
  <td style={{ padding: '5px 10px', fontSize: 11, textAlign: right ? 'right' : 'left', fontFamily: mono ? 'SF Mono, Menlo, monospace' : undefined, color }}>{children}</td>
);

interface InsightsProps {
  onViewExpense?: (id: string) => void;
}

const ExpenseInsights: React.FC<InsightsProps> = ({ onViewExpense }) => {
  // Health strip
  const [velocity, setVelocity] = useState<any>(null);
  const [forecast, setForecast] = useState<any>(null);
  const [ratio, setRatio] = useState<any>(null);
  const [concentration, setConcentration] = useState<any>(null);
  // Sections
  const [duplicates, setDuplicates] = useState<any[]>([]);
  const [missingReceipts, setMissingReceipts] = useState<any[]>([]);
  const [uncategorized, setUncategorized] = useState<any[]>([]);
  const [aging, setAging] = useState<any[]>([]);
  const [recurring, setRecurring] = useState<any[]>([]);
  const [anomalies, setAnomalies] = useState<any[]>([]);
  const [loyalty, setLoyalty] = useState<any[]>([]);
  const [largest, setLargest] = useState<any[]>([]);
  const [byEmployee, setByEmployee] = useState<any[]>([]);
  const [byMethod, setByMethod] = useState<any[]>([]);
  const [reimbAging, setReimbAging] = useState<any[]>([]);
  const [byDay, setByDay] = useState<any[]>([]);
  const [growth, setGrowth] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    const arr = (setter: (v: any[]) => void) => (r: any) => { if (!cancelled && Array.isArray(r)) setter(r); };
    const obj = (setter: (v: any) => void) => (r: any) => { if (!cancelled && r && !r.error) setter(r); };
    const quiet = () => {};
    api.exSpendingVelocity(7).then(obj(setVelocity)).catch(quiet);
    api.exForecastNextMonth().then(obj(setForecast)).catch(quiet);
    api.exExpenseRevenueRatio().then(obj(setRatio)).catch(quiet);
    api.exCategoryConcentration().then(obj(setConcentration)).catch(quiet);
    api.exFindDuplicates().then(arr(setDuplicates)).catch(quiet);
    api.exMissingReceipts(25).then(arr(setMissingReceipts)).catch(quiet);
    api.exUncategorized().then(arr(setUncategorized)).catch(quiet);
    api.exExpenseAging().then(arr(setAging)).catch(quiet);
    api.exDetectRecurring().then(arr(setRecurring)).catch(quiet);
    api.exVendorAnomalies(2).then(arr(setAnomalies)).catch(quiet);
    api.exVendorLoyalty().then(arr(setLoyalty)).catch(quiet);
    api.exLargest(10).then(arr(setLargest)).catch(quiet);
    api.exByEmployee().then(arr(setByEmployee)).catch(quiet);
    api.exByPaymentMethod().then(arr(setByMethod)).catch(quiet);
    api.exReimbursementAging().then(arr(setReimbAging)).catch(quiet);
    api.exSpendingByDay().then(arr(setByDay)).catch(quiet);
    api.exMonthlyGrowth().then(arr(setGrowth)).catch(quiet);
    return () => { cancelled = true; };
  }, []);

  const open = (id: string) => { if (id && onViewExpense) onViewExpense(id); };
  const maxDayTotal = Math.max(1, ...byDay.map((d: any) => d.total || 0));

  // Subscription math: avg_days_apart → estimated monthly + annual cost.
  const subs = recurring.map((r: any) => {
    const perMonth = r.avg_days_apart > 0 ? (30.4 / r.avg_days_apart) * r.avg_amount : 0;
    return { ...r, est_monthly: Math.round(perMonth * 100) / 100, est_annual: Math.round(perMonth * 12 * 100) / 100 };
  });
  const subsAnnualTotal = subs.reduce((s, x) => s + x.est_annual, 0);

  return (
    <div className="space-y-4">
      {/* ── 1. Health strip ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="block-card p-3">
          <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">7-Day Velocity</div>
          {velocity ? (
            <>
              <div className="text-lg font-bold font-mono mt-1" style={{ color: velocity.isAccelerating ? 'var(--color-accent-expense)' : 'var(--color-text-primary)' }}>
                {velocity.velocityPct > 0 ? '+' : ''}{velocity.velocityPct}%
              </div>
              <div className="text-[10px] text-text-muted">{formatCurrency(velocity.recentSpend)} vs {formatCurrency(velocity.priorPeriodSpend)} prior week{velocity.isAccelerating ? ' · ACCELERATING' : ''}</div>
            </>
          ) : <div className="text-text-muted text-xs mt-1">—</div>}
        </div>
        <div className="block-card p-3">
          <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">Next-Month Forecast</div>
          {forecast && forecast.trend !== 'insufficient_data' ? (
            <>
              <div className="text-lg font-bold font-mono mt-1">{formatCurrency(forecast.forecast)}</div>
              <div className="text-[10px] text-text-muted">6-mo avg {formatCurrency(forecast.avg)} · trend {forecast.trend}</div>
            </>
          ) : <div className="text-text-muted text-xs mt-1">Need 2+ months of data</div>}
        </div>
        <div className="block-card p-3">
          <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">Expense : Revenue (YTD)</div>
          {ratio ? (
            <>
              <div className="text-lg font-bold font-mono mt-1" style={{ color: ratio.ratio > 80 ? 'var(--color-accent-expense)' : ratio.ratio > 60 ? 'var(--color-accent-warning)' : 'var(--color-accent-income)' }}>{ratio.ratio}%</div>
              <div className="text-[10px] text-text-muted">{formatCurrency(ratio.ytdExpenses)} of {formatCurrency(ratio.ytdRevenue)}</div>
            </>
          ) : <div className="text-text-muted text-xs mt-1">—</div>}
        </div>
        <div className="block-card p-3">
          <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">Category Concentration</div>
          {concentration ? (
            <>
              <div className="text-lg font-bold font-mono mt-1 capitalize" style={{ color: concentration.concentration === 'high' ? 'var(--color-accent-expense)' : concentration.concentration === 'moderate' ? 'var(--color-accent-warning)' : 'var(--color-accent-income)' }}>
                {concentration.concentration}
              </div>
              <div className="text-[10px] text-text-muted">HHI {concentration.hhi} across {concentration.categories} categories</div>
            </>
          ) : <div className="text-text-muted text-xs mt-1">—</div>}
        </div>
      </div>

      {/* ── 2. Hygiene ── */}
      <div className="grid md:grid-cols-2 gap-4">
        <Section title="Possible Duplicates" icon={<Copy size={13} className="text-accent-warning" />} count={duplicates.length}>
          {duplicates.length === 0 ? <Empty msg="No duplicate pairs detected (same vendor + amount within 1 day)." /> : (
            <div style={{ maxHeight: 240, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: '1px solid var(--color-border-primary)' }}><Th>Date</Th><Th>Vendor</Th><Th>Description</Th><Th right>Amount</Th><Th /></tr></thead>
                <tbody>
                  {duplicates.map((d: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                      <Td mono>{formatDate(d.date)}</Td>
                      <Td>{d.vendor_name || '—'}</Td>
                      <Td>{(d.description || '').slice(0, 40)}</Td>
                      <Td right mono color="var(--color-accent-warning)">{formatCurrency(d.amount)} ×2</Td>
                      <Td right>
                        <button className="block-btn text-[10px]" onClick={() => open(d.id2)}>Review</button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="Missing Receipts (≥$25)" icon={<ReceiptText size={13} className="text-accent-expense" />} count={missingReceipts.length}>
          {missingReceipts.length === 0 ? <Empty msg="Every expense over $25 has a receipt attached. Audit-ready." /> : (
            <div style={{ maxHeight: 240, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: '1px solid var(--color-border-primary)' }}><Th>Date</Th><Th>Vendor</Th><Th right>Amount</Th><Th /></tr></thead>
                <tbody>
                  {missingReceipts.slice(0, 20).map((m: any) => (
                    <tr key={m.id} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                      <Td mono>{formatDate(m.date)}</Td>
                      <Td>{m.vendor_name || (m.description || '').slice(0, 30) || '—'}</Td>
                      <Td right mono>{formatCurrency(m.amount)}</Td>
                      <Td right><button className="block-btn text-[10px]" onClick={() => open(m.id)}>Attach</button></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="Uncategorized" icon={<AlertTriangle size={13} className="text-accent-warning" />} count={uncategorized.length}>
          {uncategorized.length === 0 ? <Empty msg="Everything is categorized." /> : (
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {uncategorized.slice(0, 15).map((u: any) => (
                    <tr key={u.id} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                      <Td mono>{formatDate(u.date)}</Td>
                      <Td>{(u.description || 'No description').slice(0, 40)}</Td>
                      <Td right mono>{formatCurrency(u.amount)}</Td>
                      <Td right><button className="block-btn text-[10px]" onClick={() => open(u.id)}>Fix</button></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="Pending Approval Aging" icon={<Activity size={13} className="text-accent-blue" />}>
          {aging.every((b: any) => !b.count) ? <Empty msg="No pending expenses awaiting processing." /> : (
            <div className="p-3 space-y-1.5">
              {aging.map((b: any) => (
                <div key={b.label} className="flex items-center gap-2 text-[11px]">
                  <span style={{ width: 70 }} className="text-text-muted">{b.label}</span>
                  <div style={{ flex: 1, height: 6, background: 'var(--color-bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, (b.count / Math.max(1, ...aging.map((x: any) => x.count))) * 100)}%`, height: '100%', background: b.label.startsWith('90') || b.label.startsWith('61') ? 'var(--color-accent-expense)' : 'var(--color-accent-blue)' }} />
                  </div>
                  <span className="font-mono" style={{ width: 90, textAlign: 'right' }}>{b.count} · {formatCurrency(b.total)}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      {/* ── 3. Subscriptions / recurring ── */}
      <Section title="Detected Subscriptions & Recurring Spend" icon={<Repeat size={13} className="text-accent-blue" />} count={subs.length}>
        {subs.length === 0 ? <Empty msg="No recurring patterns yet (needs 3+ same-vendor charges at a regular interval)." /> : (
          <>
            <div className="px-4 py-2 text-[11px] text-text-secondary" style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
              Estimated recurring commitment: <strong className="font-mono">{formatCurrency(subs.reduce((s, x) => s + x.est_monthly, 0))}/mo</strong>
              {' '}(<strong className="font-mono">{formatCurrency(subsAnnualTotal)}/yr</strong>) — review for unused services.
            </div>
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: '1px solid var(--color-border-primary)' }}><Th>Description</Th><Th right>Avg Charge</Th><Th right>Every</Th><Th right>Est. Monthly</Th><Th right>Est. Annual</Th><Th right>Seen</Th></tr></thead>
                <tbody>
                  {subs.map((r: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                      <Td>{(r.description || 'Recurring charge').slice(0, 45)}</Td>
                      <Td right mono>{formatCurrency(r.avg_amount)}</Td>
                      <Td right mono>{r.avg_days_apart}d</Td>
                      <Td right mono>{formatCurrency(r.est_monthly)}</Td>
                      <Td right mono color="var(--color-accent-warning)">{formatCurrency(r.est_annual)}</Td>
                      <Td right mono>{r.occurrences}×</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>

      {/* ── 4. Vendors ── */}
      <div className="grid md:grid-cols-2 gap-4">
        <Section title="Vendor Price Anomalies (z > 2)" icon={<Store size={13} className="text-accent-expense" />} count={anomalies.length}>
          {anomalies.length === 0 ? <Empty msg="No outlier charges versus each vendor's normal range." /> : (
            <div style={{ maxHeight: 240, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: '1px solid var(--color-border-primary)' }}><Th>Vendor</Th><Th right>Charged</Th><Th right>Typical</Th><Th right>σ</Th><Th /></tr></thead>
                <tbody>
                  {anomalies.slice(0, 12).map((a: any) => (
                    <tr key={a.id} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                      <Td>{a.vendor_name || '—'}</Td>
                      <Td right mono color="var(--color-accent-expense)">{formatCurrency(a.amount)}</Td>
                      <Td right mono>{formatCurrency(a.avg_amt)}</Td>
                      <Td right mono>{Number(a.z_score).toFixed(1)}</Td>
                      <Td right><button className="block-btn text-[10px]" onClick={() => open(a.id)}>View</button></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="Top Vendors by Spend" icon={<Store size={13} className="text-accent-blue" />} count={loyalty.length}>
          {loyalty.length === 0 ? <Empty msg="Not enough vendor history yet." /> : (
            <div style={{ maxHeight: 240, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: '1px solid var(--color-border-primary)' }}><Th>Vendor</Th><Th right>Total</Th><Th right>Txns</Th><Th right>Avg</Th><Th right>Last Used</Th></tr></thead>
                <tbody>
                  {loyalty.slice(0, 12).map((v: any) => (
                    <tr key={v.id} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                      <Td>{v.name}</Td>
                      <Td right mono>{formatCurrency(v.total_spent)}</Td>
                      <Td right mono>{v.frequency}</Td>
                      <Td right mono>{formatCurrency(v.avg_transaction)}</Td>
                      <Td right mono color={v.days_since_last > 90 ? 'var(--color-text-muted)' : undefined}>{v.days_since_last}d ago</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      {/* ── 5. People & process ── */}
      <div className="grid md:grid-cols-3 gap-4">
        <Section title="Spend by Submitter" icon={<Users size={13} className="text-accent-blue" />}>
          {byEmployee.length === 0 ? <Empty msg="No per-person data." /> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {byEmployee.slice(0, 8).map((e: any, i: number) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                    <Td>{e.employee || 'Unassigned'}</Td>
                    <Td right mono>{formatCurrency(e.total)}</Td>
                    <Td right mono>{e.count}×</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="By Payment Method (12mo)" icon={<Activity size={13} className="text-accent-blue" />}>
          {byMethod.length === 0 ? <Empty msg="No data." /> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {byMethod.map((m: any, i: number) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                    <Td>{String(m.method).replace(/_/g, ' ')}</Td>
                    <Td right mono>{formatCurrency(m.total)}</Td>
                    <Td right mono>{m.count}×</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Unreimbursed Aging" icon={<AlertTriangle size={13} className="text-accent-warning" />} count={reimbAging.length}>
          {reimbAging.length === 0 ? <Empty msg="No outstanding reimbursements." /> : (
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {reimbAging.slice(0, 10).map((r: any) => (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                      <Td mono color={r.days_outstanding > 30 ? 'var(--color-accent-expense)' : undefined}>{r.days_outstanding}d</Td>
                      <Td>{(r.description || '').slice(0, 25)}</Td>
                      <Td right mono>{formatCurrency(r.amount)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      {/* ── 6. Trends ── */}
      <div className="grid md:grid-cols-2 gap-4">
        <Section title="Spend by Day of Week" icon={<TrendingUp size={13} className="text-accent-blue" />}>
          {byDay.length === 0 ? <Empty msg="No data." /> : (
            <div className="p-3 space-y-1.5">
              {byDay.map((d: any) => (
                <div key={d.day_num} className="flex items-center gap-2 text-[11px]">
                  <span style={{ width: 76 }} className="text-text-muted">{d.day_name}</span>
                  <div style={{ flex: 1, height: 6, background: 'var(--color-bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${(d.total / maxDayTotal) * 100}%`, height: '100%', background: 'var(--cust-series-expense, var(--color-accent-expense))' }} />
                  </div>
                  <span className="font-mono" style={{ width: 100, textAlign: 'right' }}>{formatCurrency(d.total)}</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Month-over-Month" icon={<TrendingUp size={13} className="text-accent-blue" />}>
          {growth.length === 0 ? <Empty msg="No data." /> : (
            <div style={{ maxHeight: 240, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: '1px solid var(--color-border-primary)' }}><Th>Month</Th><Th right>Total</Th><Th right>Δ vs Prior</Th></tr></thead>
                <tbody>
                  {growth.slice(-12).reverse().map((g: any) => {
                    const delta = g.prev_month ? ((g.total - g.prev_month) / g.prev_month) * 100 : null;
                    return (
                      <tr key={g.month} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                        <Td mono>{g.month}</Td>
                        <Td right mono>{formatCurrency(g.total)}</Td>
                        <Td right mono color={delta == null ? undefined : delta > 0 ? 'var(--color-accent-expense)' : 'var(--color-accent-income)'}>
                          {delta == null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
};

export default ExpenseInsights;
