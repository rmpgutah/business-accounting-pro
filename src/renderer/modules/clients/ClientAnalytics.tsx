import React, { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';

// ─── Helpers ────────────────────────────────────────────────────
function periodBounds(monthsBack = 12): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - monthsBack);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="block-card p-0 overflow-hidden" style={{ borderRadius: 'var(--app-radius)' }}>
      <div className="px-4 py-3 border-b border-border-primary">
        <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">{title}</div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function EmptyState({ msg }: { msg: string }) {
  return <div className="text-xs text-text-muted py-8 text-center">{msg}</div>;
}

function LoadingState() {
  return <div className="text-xs text-text-muted py-8 text-center">Loading…</div>;
}

// ─── LTV Leaderboard ────────────────────────────────────────────
function LtvLeaderboard({
  onSelectClient,
}: {
  onSelectClient?: (id: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // sw:customer-ltv → { id, name, ltv, invoice_count, first_invoice, last_invoice, relationship_days }
        const data = await api.swCustomerLTV();
        if (!cancelled) setRows(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <SectionCard title="Customer LTV Leaderboard (top 20 by paid revenue)">
      {loading ? <LoadingState /> : rows.length === 0 ? <EmptyState msg="No paid invoice data available" /> : (
        <div className="overflow-x-auto">
          <table className="block-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Client</th>
                <th className="text-right">LTV</th>
                <th className="text-right">Invoices</th>
                <th>First Invoice</th>
                <th>Last Invoice</th>
                <th className="text-right">Tenure (days)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any, i: number) => (
                <tr
                  key={r.id ?? i}
                  className={onSelectClient && r.id ? 'cursor-pointer' : ''}
                  onClick={() => onSelectClient && r.id && onSelectClient(r.id)}
                >
                  <td className="text-text-muted text-xs font-mono">{i + 1}</td>
                  <td className="text-text-primary font-medium text-xs">{r.name}</td>
                  <td className="text-right font-mono text-xs" style={{ color: 'var(--color-accent-income)' }}>
                    {formatCurrency(r.ltv ?? 0)}
                  </td>
                  <td className="text-right font-mono text-xs text-text-secondary">{r.invoice_count ?? 0}</td>
                  <td className="text-xs text-text-secondary">{r.first_invoice ? formatDate(r.first_invoice) : '--'}</td>
                  <td className="text-xs text-text-secondary">{r.last_invoice ? formatDate(r.last_invoice) : '--'}</td>
                  <td className="text-right font-mono text-xs text-text-secondary">{r.relationship_days ?? '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

// ─── Retention & Acquisition ─────────────────────────────────────
function RetentionAcquisition() {
  const [loading, setLoading] = useState(true);
  const [retention, setRetention] = useState<any>(null);
  const [acquisition, setAcquisition] = useState<any[]>([]);
  const [retCalc, setRetCalc] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // sw:client-retention → { totalClients, activeInLast12Months, retentionRate }
        const retData = await api.swClientRetention();
        if (!cancelled) setRetention(retData && typeof retData === 'object' ? retData : null);
      } catch {
        if (!cancelled) setRetention(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // sw:client-acquisition → { month, new_clients }[]
        const acqData = await api.swClientAcquisition(12);
        if (!cancelled) setAcquisition(Array.isArray(acqData) ? acqData : []);
      } catch {
        if (!cancelled) setAcquisition([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { start, end } = periodBounds(12);
        // feat:retention:calc → { gross_retention, net_retention, starting_mrr, ending_mrr, churned_mrr, expansion_mrr }
        const rc = await api.featRetentionCalc(start, end);
        if (!cancelled) setRetCalc(rc && typeof rc === 'object' && !('error' in rc) ? rc : null);
      } catch {
        if (!cancelled) setRetCalc(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <SectionCard title="Retention & Acquisition">
      {loading ? <LoadingState /> : (
        <div className="space-y-6">
          {/* Retention KPIs */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="block-card p-4 text-center" style={{ borderRadius: 'var(--app-radius)' }}>
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Total Clients</div>
              <div className="text-xl font-mono font-bold text-text-primary mt-1">{retention?.totalClients ?? '--'}</div>
            </div>
            <div className="block-card p-4 text-center" style={{ borderRadius: 'var(--app-radius)' }}>
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Active (12 mo)</div>
              <div className="text-xl font-mono font-bold mt-1" style={{ color: 'var(--color-accent-income)' }}>
                {retention?.activeInLast12Months ?? '--'}
              </div>
            </div>
            <div className="block-card p-4 text-center" style={{ borderRadius: 'var(--app-radius)' }}>
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Retention Rate</div>
              <div className="text-xl font-mono font-bold mt-1" style={{ color: 'var(--color-accent-income)' }}>
                {retention?.retentionRate != null ? `${retention.retentionRate}%` : '--'}
              </div>
            </div>
            <div className="block-card p-4 text-center" style={{ borderRadius: 'var(--app-radius)' }}>
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Gross Rev Retention</div>
              <div className="text-xl font-mono font-bold mt-1" style={{ color: retCalc?.gross_retention >= 80 ? 'var(--color-accent-income)' : 'var(--color-accent-warning)' }}>
                {retCalc?.gross_retention != null ? `${retCalc.gross_retention}%` : '--'}
              </div>
            </div>
          </div>

          {/* Acquisition bar chart */}
          {acquisition.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">New Client Acquisition by Month</div>
              <div className="flex items-end gap-1.5" style={{ height: '100px' }}>
                {(() => {
                  const maxAcq = Math.max(...acquisition.map((a: any) => a.new_clients || 0), 1);
                  return acquisition.map((m: any, i: number) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <div className="text-[9px] font-mono text-text-muted">{m.new_clients}</div>
                      <div
                        className="w-full"
                        style={{
                          height: `${Math.max(((m.new_clients || 0) / maxAcq) * 72, 3)}px`,
                          background: 'var(--color-accent-income)',
                          borderRadius: '2px 2px 0 0',
                        }}
                      />
                      <div className="text-[8px] text-text-muted">{m.month?.slice(5)}</div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          )}

          {/* Revenue retention detail */}
          {retCalc && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div>
                <div className="text-[10px] text-text-muted mb-1">Starting MRR (proxy)</div>
                <div className="text-sm font-mono font-bold text-text-primary">{formatCurrency(retCalc.starting_mrr)}</div>
              </div>
              <div>
                <div className="text-[10px] text-text-muted mb-1">Ending MRR (proxy)</div>
                <div className="text-sm font-mono font-bold text-text-primary">{formatCurrency(retCalc.ending_mrr)}</div>
              </div>
              <div>
                <div className="text-[10px] text-text-muted mb-1">Net Revenue Retention</div>
                <div
                  className="text-sm font-mono font-bold"
                  style={{ color: retCalc.net_retention >= 100 ? 'var(--color-accent-income)' : 'var(--color-accent-expense)' }}
                >
                  {retCalc.net_retention}%
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

// ─── Cohort Retention Grid ───────────────────────────────────────
function CohortGrid() {
  const [loading, setLoading] = useState(true);
  const [cohorts, setCohorts] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // feat:cohort:build → { cohort_month, period_offset, customers_remaining, retention_pct }[]
        const data = await api.featCohortBuild();
        if (!cancelled) setCohorts(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setCohorts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const cohortMonths = [...new Set(cohorts.map((r: any) => r.cohort_month))].sort();
  const maxOffset = cohorts.reduce((m: number, r: any) => Math.max(m, r.period_offset || 0), 0);
  const offsets = Array.from({ length: Math.min(maxOffset + 1, 13) }, (_, i) => i);

  function retPct(cohort: string, offset: number): number | null {
    const row = cohorts.find((r: any) => r.cohort_month === cohort && r.period_offset === offset);
    return row ? row.retention_pct : null;
  }

  function retColor(pct: number | null): string {
    if (pct === null) return 'transparent';
    if (pct >= 80) return 'var(--color-accent-income)';
    if (pct >= 50) return 'var(--color-accent-warning)';
    return 'var(--color-accent-expense)';
  }

  return (
    <SectionCard title="Cohort Retention Grid (acquisition cohort × months retained)">
      {loading ? <LoadingState /> : cohortMonths.length === 0 ? <EmptyState msg="Not enough invoice history to build cohorts" /> : (
        <div className="overflow-x-auto">
          <table style={{ borderCollapse: 'collapse', fontSize: '11px', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--color-text-muted)', fontWeight: 600, fontSize: '10px', whiteSpace: 'nowrap' }}>Cohort</th>
                {offsets.map((o) => (
                  <th key={o} style={{ textAlign: 'center', padding: '4px 6px', color: 'var(--color-text-muted)', fontWeight: 600, fontSize: '10px' }}>
                    {o === 0 ? 'M0' : `+${o}m`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cohortMonths.map((cohort: string) => (
                <tr key={cohort}>
                  <td style={{ padding: '4px 8px', color: 'var(--color-text-secondary)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{cohort}</td>
                  {offsets.map((o) => {
                    const pct = retPct(cohort, o);
                    return (
                      <td key={o} style={{ textAlign: 'center', padding: '3px 6px' }}>
                        {pct !== null ? (
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '2px 6px',
                              borderRadius: 'var(--app-radius)',
                              background: retColor(pct),
                              color: 'var(--color-text-primary)',
                              fontFamily: 'monospace',
                              fontWeight: 700,
                              fontSize: '10px',
                              opacity: pct === 0 ? 0.3 : 1,
                            }}
                          >
                            {pct}%
                          </span>
                        ) : (
                          <span style={{ color: 'var(--color-text-muted)', fontSize: '10px' }}>—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

// ─── Churn Risk Worklist ─────────────────────────────────────────
function ChurnWorklist({
  onSelectClient,
}: {
  onSelectClient?: (id: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // feat:report:churn-predict → { client_id, client_name, email, last_invoice, invoice_count, total_revenue, days_since_last, churn_risk, risk_score, as_of }[]
        const data = await api.featReportChurnPredict();
        if (!cancelled) setRows(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function riskBadgeStyle(risk: string): React.CSSProperties {
    if (risk === 'high') return { color: 'var(--color-accent-expense)', background: 'color-mix(in srgb, var(--color-accent-expense) 12%, transparent)', padding: '2px 8px', borderRadius: 'var(--app-radius)', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' };
    if (risk === 'medium') return { color: 'var(--color-accent-warning)', background: 'color-mix(in srgb, var(--color-accent-warning) 12%, transparent)', padding: '2px 8px', borderRadius: 'var(--app-radius)', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' };
    return { color: 'var(--color-accent-income)', background: 'color-mix(in srgb, var(--color-accent-income) 12%, transparent)', padding: '2px 8px', borderRadius: 'var(--app-radius)', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' };
  }

  const atRisk = rows.filter((r: any) => r.churn_risk !== 'low');

  return (
    <SectionCard title={`Churn-Risk Worklist (${atRisk.length} at-risk clients)`}>
      {loading ? <LoadingState /> : rows.length === 0 ? <EmptyState msg="No client activity found" /> : (
        <div className="overflow-x-auto">
          <table className="block-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Risk</th>
                <th className="text-right">Score</th>
                <th className="text-right">Days Since Last Invoice</th>
                <th className="text-right">Total Revenue</th>
                <th className="text-right">Invoices</th>
                <th>Last Invoice</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any, i: number) => (
                <tr
                  key={r.client_id ?? i}
                  className={onSelectClient && r.client_id ? 'cursor-pointer' : ''}
                  onClick={() => onSelectClient && r.client_id && onSelectClient(r.client_id)}
                >
                  <td className="text-text-primary font-medium text-xs">{r.client_name}</td>
                  <td><span style={riskBadgeStyle(r.churn_risk)}>{r.churn_risk}</span></td>
                  <td className="text-right font-mono text-xs text-text-secondary">{r.risk_score}</td>
                  <td className="text-right font-mono text-xs" style={{ color: r.days_since_last > 180 ? 'var(--color-accent-expense)' : r.days_since_last > 90 ? 'var(--color-accent-warning)' : 'var(--color-text-secondary)' }}>
                    {r.days_since_last ?? '--'}
                  </td>
                  <td className="text-right font-mono text-xs" style={{ color: 'var(--color-accent-income)' }}>{formatCurrency(r.total_revenue ?? 0)}</td>
                  <td className="text-right font-mono text-xs text-text-secondary">{r.invoice_count ?? 0}</td>
                  <td className="text-xs text-text-secondary">{r.last_invoice ? formatDate(r.last_invoice) : '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {atRisk.length > 0 && (
            <div className="flex items-center gap-2 mt-3 px-1 text-xs" style={{ color: 'var(--color-accent-warning)' }}>
              <AlertTriangle size={12} />
              {atRisk.length} client{atRisk.length !== 1 ? 's' : ''} show medium or high churn risk
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

// ─── LTV:CAC Scorecard ───────────────────────────────────────────
function LtvCacScorecard() {
  const [loading, setLoading] = useState(true);
  const [ltvCac, setLtvCac] = useState<any>(null);
  const [ltv, setLtv] = useState<any>(null);
  const [cac, setCac] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // feat:ltv-cac:ratio → { ltv, cac, ratio, health }
        const ratioData = await api.featLtvCacRatio();
        if (!cancelled && ratioData && !('error' in ratioData)) setLtvCac(ratioData);
      } catch {
        if (!cancelled) setLtvCac(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // feat:ltv:calc → { ltv, avg_purchase, purchase_frequency, sample_size }
        const ltvData = await api.featLtvCalc();
        if (!cancelled && ltvData && !('error' in ltvData)) setLtv(ltvData);
      } catch {
        if (!cancelled) setLtv(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // feat:cac:calc → { cac, sales_marketing_cost, new_customers }
        const cacData = await api.featCacCalc();
        if (!cancelled && cacData && !('error' in cacData)) setCac(cacData);
      } catch {
        if (!cancelled) setCac(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function healthColor(health: string): string {
    if (health === 'healthy') return 'var(--color-accent-income)';
    if (health === 'fair') return 'var(--color-accent-warning)';
    return 'var(--color-accent-expense)';
  }

  return (
    <SectionCard title="LTV:CAC Scorecard">
      {loading ? <LoadingState /> : (
        <div className="space-y-5">
          {/* Ratio hero */}
          {ltvCac && (
            <div className="flex items-center gap-6">
              <div className="text-center">
                <div className="text-4xl font-mono font-bold" style={{ color: healthColor(ltvCac.health) }}>
                  {ltvCac.ratio != null ? `${ltvCac.ratio}x` : '--'}
                </div>
                <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mt-1">LTV:CAC Ratio</div>
                <div
                  className="mt-2 inline-block px-3 py-1 text-xs font-bold uppercase tracking-wider"
                  style={{
                    borderRadius: 'var(--app-radius)',
                    color: healthColor(ltvCac.health),
                    background: `color-mix(in srgb, ${healthColor(ltvCac.health)} 12%, transparent)`,
                  }}
                >
                  {ltvCac.health}
                </div>
              </div>
              <div className="text-xs text-text-muted leading-relaxed max-w-xs">
                A ratio ≥ 3x is considered healthy. Below 1x means you spend more acquiring a customer than they generate in lifetime value.
              </div>
            </div>
          )}

          {/* Component stat cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="block-card p-4 text-center" style={{ borderRadius: 'var(--app-radius)' }}>
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">LTV</div>
              <div className="text-lg font-mono font-bold mt-1" style={{ color: 'var(--color-accent-income)' }}>
                {formatCurrency(ltvCac?.ltv ?? ltv?.ltv ?? 0)}
              </div>
              <div className="text-[9px] text-text-muted mt-0.5">avg customer value</div>
            </div>
            <div className="block-card p-4 text-center" style={{ borderRadius: 'var(--app-radius)' }}>
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">CAC</div>
              <div className="text-lg font-mono font-bold mt-1" style={{ color: 'var(--color-accent-expense)' }}>
                {formatCurrency(ltvCac?.cac ?? cac?.cac ?? 0)}
              </div>
              <div className="text-[9px] text-text-muted mt-0.5">acquisition cost</div>
            </div>
            {ltv && (
              <>
                <div className="block-card p-4 text-center" style={{ borderRadius: 'var(--app-radius)' }}>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Avg Purchase</div>
                  <div className="text-lg font-mono font-bold text-text-primary mt-1">
                    {formatCurrency(ltv.avg_purchase ?? 0)}
                  </div>
                  <div className="text-[9px] text-text-muted mt-0.5">per invoice</div>
                </div>
                <div className="block-card p-4 text-center" style={{ borderRadius: 'var(--app-radius)' }}>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Purchase Freq</div>
                  <div className="text-lg font-mono font-bold text-text-primary mt-1">
                    {ltv.purchase_frequency ?? '--'}x
                  </div>
                  <div className="text-[9px] text-text-muted mt-0.5">invoices / customer</div>
                </div>
              </>
            )}
          </div>

          {/* CAC detail */}
          {cac && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-[10px] text-text-muted mb-1">Sales & Marketing Cost (12 mo)</div>
                <div className="text-sm font-mono font-bold text-text-primary">{formatCurrency(cac.sales_marketing_cost)}</div>
              </div>
              <div>
                <div className="text-[10px] text-text-muted mb-1">New Customers Acquired (12 mo)</div>
                <div className="text-sm font-mono font-bold text-text-primary">{cac.new_customers}</div>
              </div>
            </div>
          )}

          {!ltvCac && !ltv && !cac && (
            <EmptyState msg="Insufficient data to compute LTV:CAC. Ensure invoices and expense categories exist." />
          )}
        </div>
      )}
    </SectionCard>
  );
}

// ─── KPI Strip (top of view) ─────────────────────────────────────
function KpiStrip() {
  const [ltvCac, setLtvCac] = useState<any>(null);
  const [retention, setRetention] = useState<any>(null);
  const [churnRows, setChurnRows] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await api.featLtvCacRatio();
        if (!cancelled && d && !('error' in d)) setLtvCac(d);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await api.swClientRetention();
        if (!cancelled && d && typeof d === 'object') setRetention(d);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await api.featReportChurnPredict();
        if (!cancelled && Array.isArray(d)) setChurnRows(d);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  const atRisk = churnRows.filter((r: any) => r.churn_risk !== 'low').length;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div className="block-card p-4 text-center" style={{ borderRadius: 'var(--app-radius)' }}>
        <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">LTV:CAC Ratio</div>
        <div
          className="text-xl font-mono font-bold mt-1"
          style={{ color: ltvCac?.ratio >= 3 ? 'var(--color-accent-income)' : ltvCac?.ratio >= 1.5 ? 'var(--color-accent-warning)' : ltvCac?.ratio != null ? 'var(--color-accent-expense)' : 'var(--color-text-muted)' }}
        >
          {ltvCac?.ratio != null ? `${ltvCac.ratio}x` : '--'}
        </div>
        <div className="text-[9px] text-text-muted mt-0.5">{ltvCac?.health ?? 'calculating…'}</div>
      </div>
      <div className="block-card p-4 text-center" style={{ borderRadius: 'var(--app-radius)' }}>
        <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Retention Rate</div>
        <div className="text-xl font-mono font-bold mt-1" style={{ color: 'var(--color-accent-income)' }}>
          {retention?.retentionRate != null ? `${retention.retentionRate}%` : '--'}
        </div>
        <div className="text-[9px] text-text-muted mt-0.5">active / total</div>
      </div>
      <div className="block-card p-4 text-center" style={{ borderRadius: 'var(--app-radius)' }}>
        <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">At-Risk Clients</div>
        <div
          className="text-xl font-mono font-bold mt-1 flex items-center justify-center gap-1.5"
          style={{ color: atRisk > 0 ? 'var(--color-accent-expense)' : 'var(--color-accent-income)' }}
        >
          {atRisk > 0 && <AlertTriangle size={14} />}
          {atRisk}
        </div>
        <div className="text-[9px] text-text-muted mt-0.5">medium + high churn risk</div>
      </div>
      <div className="block-card p-4 text-center" style={{ borderRadius: 'var(--app-radius)' }}>
        <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Avg LTV</div>
        <div className="text-xl font-mono font-bold mt-1" style={{ color: 'var(--color-accent-income)' }}>
          {ltvCac?.ltv != null ? formatCurrency(ltvCac.ltv) : '--'}
        </div>
        <div className="text-[9px] text-text-muted mt-0.5">per customer</div>
      </div>
    </div>
  );
}

// ─── Main Export ─────────────────────────────────────────────────
interface ClientAnalyticsProps {
  onSelectClient?: (id: string) => void;
}

const ClientAnalytics: React.FC<ClientAnalyticsProps> = ({ onSelectClient }) => {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-text-primary">Client Analytics</h2>
        <div className="text-xs text-text-muted">LTV, cohort, churn &amp; acquisition intelligence</div>
      </div>

      {/* KPI strip */}
      <KpiStrip />

      {/* Section: LTV Leaderboard */}
      <LtvLeaderboard onSelectClient={onSelectClient} />

      {/* Section: Retention & Acquisition */}
      <RetentionAcquisition />

      {/* Section: Cohort Grid */}
      <CohortGrid />

      {/* Section: Churn Worklist */}
      <ChurnWorklist onSelectClient={onSelectClient} />

      {/* Section: LTV:CAC Scorecard */}
      <LtvCacScorecard />
    </div>
  );
};

export default ClientAnalytics;
