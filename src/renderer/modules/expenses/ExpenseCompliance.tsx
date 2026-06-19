// src/renderer/modules/expenses/ExpenseCompliance.tsx
//
// Expense Compliance & Cross-Module — wave 2 of surfacing the dark ex:*
// backend (wave 1: ExpenseInsights). Sections:
//   1. Compliance strip — 30-day policy compliance rate, data quality
//      score, submission timeliness, avg approval processing time
//   2. Audit heuristics — weekend expenses, round-number-no-receipt
//      expenses (classic estimate/fraud screens)
//   3. Tax — deductible vs non-deductible split + per-category
//      deduction summary for the current year
//   4. Cross-module — billable by client, project budget consumption,
//      loan-linked expense roll-up, department spend (this month),
//      tag summary, quarterly comparison
//   5. Actions — full CSV export, stale-approval escalation check,
//      orphan-row integrity scan
//
// Same resilience pattern as Insights: every section loads
// independently; one failed query never blanks the page.

import React, { useEffect, useState } from 'react';
import {
  ShieldCheck, AlertTriangle, Landmark, FolderKanban, Tag, Download,
  Clock, SearchCheck, CalendarX, CircleDollarSign,
} from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import { downloadCSVBlob } from '../../lib/csv-export';
import { useToast } from '../../components/ToastProvider';

const Section: React.FC<{ title: string; icon: React.ReactNode; count?: number; children: React.ReactNode }> = ({ title, icon, count, children }) => (
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
const Td: React.FC<{ children?: React.ReactNode; right?: boolean; mono?: boolean; color?: string }> = ({ children, right, mono, color }) => (
  <td style={{ padding: '5px 10px', fontSize: 11, textAlign: right ? 'right' : 'left', fontFamily: mono ? 'SF Mono, Menlo, monospace' : undefined, color }}>{children}</td>
);

const pctColor = (pct: number, goodHigh = true): string => {
  const v = goodHigh ? pct : 100 - pct;
  return v >= 90 ? 'var(--color-accent-income)' : v >= 70 ? 'var(--color-accent-warning)' : 'var(--color-accent-expense)';
};

interface Props { onViewExpense?: (id: string) => void }

const ExpenseCompliance: React.FC<Props> = ({ onViewExpense }) => {
  const toast = useToast();
  // Strip
  const [policy, setPolicy] = useState<any>(null);
  const [quality, setQuality] = useState<any>(null);
  const [timeliness, setTimeliness] = useState<any>(null);
  const [processing, setProcessing] = useState<any>(null);
  // Audit heuristics
  const [weekend, setWeekend] = useState<any[]>([]);
  const [roundNums, setRoundNums] = useState<any[]>([]);
  // Tax
  const [taxSplit, setTaxSplit] = useState<any>(null);
  const [taxByCat, setTaxByCat] = useState<any[]>([]);
  // Cross-module
  const [billable, setBillable] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loanLinked, setLoanLinked] = useState<any[]>([]);
  const [deptSpend, setDeptSpend] = useState<any[]>([]);
  const [tags, setTags] = useState<any[]>([]);
  const [quarters, setQuarters] = useState<any[]>([]);
  const [byStatus, setByStatus] = useState<any[]>([]);
  // Actions
  const [exporting, setExporting] = useState(false);
  const [staleResult, setStaleResult] = useState<any>(null);
  const [orphans, setOrphans] = useState<any[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const arr = (setter: (v: any[]) => void) => (r: any) => { if (!cancelled && Array.isArray(r)) setter(r); };
    const obj = (setter: (v: any) => void) => (r: any) => { if (!cancelled && r && !r.error) setter(r); };
    const quiet = () => {};
    api.exPolicyCompliance().then(obj(setPolicy)).catch(quiet);
    api.exBulkDataQuality().then(obj(setQuality)).catch(quiet);
    api.exSubmissionTimeliness().then(obj(setTimeliness)).catch(quiet);
    api.exAvgProcessingTime().then(obj(setProcessing)).catch(quiet);
    api.exWeekendExpenses().then(arr(setWeekend)).catch(quiet);
    api.exRoundNumber().then(arr(setRoundNums)).catch(quiet);
    api.exTaxDeductibleBreakdown().then(obj(setTaxSplit)).catch(quiet);
    api.exTaxDeductionSummary().then(arr(setTaxByCat)).catch(quiet);
    api.exBillableByClient().then(arr(setBillable)).catch(quiet);
    api.exProjectSummary().then(arr(setProjects)).catch(quiet);
    api.exLoanLinked().then(arr(setLoanLinked)).catch(quiet);
    api.exDeptBudgetVariance().then(arr(setDeptSpend)).catch(quiet);
    api.exTagsSummary().then(arr(setTags)).catch(quiet);
    api.exQuarterlyComparison().then(arr(setQuarters)).catch(quiet);
    api.exCountByStatus().then(arr(setByStatus)).catch(quiet);
    return () => { cancelled = true; };
  }, []);

  const open = (id: string) => { if (id && onViewExpense) onViewExpense(id); };

  const exportCSV = async () => {
    setExporting(true);
    try {
      const rows = await api.exExportCSV();
      if (!Array.isArray(rows) || rows.length === 0) { toast.error('No expenses to export'); return; }
      // downloadCSVBlob handles quoting/escaping from raw row objects.
      downloadCSVBlob(rows as Record<string, any>[], `expenses-export-${new Date().toISOString().slice(0, 10)}.csv`);
      toast.success(`Exported ${rows.length} expenses`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* ── Actions bar ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <button className="block-btn text-xs flex items-center gap-1.5" disabled={exporting} onClick={exportCSV}>
          <Download size={12} /> {exporting ? 'Exporting…' : 'Export All to CSV'}
        </button>
        <button
          className="block-btn text-xs flex items-center gap-1.5"
          onClick={async () => {
            const r = await api.exEscalateStale(7);
            setStaleResult(r && !r.error ? r : null);
            if (r?.staleCount === 0) toast.success('No expenses stuck in approval > 7 days');
          }}
          title="Find expenses stuck pending approval for more than 7 days"
        >
          <Clock size={12} /> Check Stale Approvals
        </button>
        <button
          className="block-btn text-xs flex items-center gap-1.5"
          onClick={async () => {
            const r = await api.exFindOrphans();
            setOrphans(Array.isArray(r) ? r : []);
            if (Array.isArray(r) && r.length === 0) toast.success('No orphaned expense rows — database integrity OK');
          }}
          title="Integrity scan: expense rows whose company no longer exists"
        >
          <SearchCheck size={12} /> Integrity Scan
        </button>
        {staleResult && staleResult.staleCount > 0 && (
          <span className="text-[11px] font-bold text-accent-warning">{staleResult.staleCount} stuck &gt; {staleResult.threshold}d in approval</span>
        )}
        {orphans && orphans.length > 0 && (
          <span className="text-[11px] font-bold text-accent-expense">{orphans.length} orphaned rows found</span>
        )}
      </div>

      {/* ── 1. Compliance strip ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="block-card p-3">
          <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">Policy Compliance (30d)</div>
          {policy ? (
            <>
              <div className="text-lg font-bold font-mono mt-1" style={{ color: pctColor(policy.complianceRate) }}>{policy.complianceRate}%</div>
              <div className="text-[10px] text-text-muted">{policy.missingReceipts} no-receipt · {policy.flaggedForReview} flagged · {policy.rejected} rejected of {policy.totalLast30Days}</div>
            </>
          ) : <div className="text-text-muted text-xs mt-1">—</div>}
        </div>
        <div className="block-card p-3">
          <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">Data Quality (90d)</div>
          {quality ? (
            <>
              <div className="text-lg font-bold font-mono mt-1" style={{ color: pctColor(quality.overallQuality) }}>{quality.overallQuality}%</div>
              <div className="text-[10px] text-text-muted">{quality.missingDescription} no-desc · {quality.missingCategory} no-cat · {quality.missingVendor} no-vendor · {quality.missingReceipt} no-receipt</div>
            </>
          ) : <div className="text-text-muted text-xs mt-1">—</div>}
        </div>
        <div className="block-card p-3">
          <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">Submission Delay (90d)</div>
          {timeliness && timeliness.sample_size > 0 ? (
            <>
              <div className="text-lg font-bold font-mono mt-1" style={{ color: timeliness.avg_delay_days > 14 ? 'var(--color-accent-expense)' : timeliness.avg_delay_days > 7 ? 'var(--color-accent-warning)' : 'var(--color-accent-income)' }}>
                {timeliness.avg_delay_days}d avg
              </div>
              <div className="text-[10px] text-text-muted">expense date → entered · {timeliness.sample_size} samples</div>
            </>
          ) : <div className="text-text-muted text-xs mt-1">—</div>}
        </div>
        <div className="block-card p-3">
          <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">Approval Time (90d)</div>
          {processing && processing.sample > 0 ? (
            <>
              <div className="text-lg font-bold font-mono mt-1">{processing.avg_days}d avg</div>
              <div className="text-[10px] text-text-muted">submitted → approved · {processing.sample} approvals</div>
            </>
          ) : <div className="text-text-muted text-xs mt-1">No approvals in 90d</div>}
        </div>
      </div>

      {/* ── 2. Audit heuristics ── */}
      <div className="grid md:grid-cols-2 gap-4">
        <Section title="Weekend Expenses (90d)" icon={<CalendarX size={13} className="text-accent-warning" />} count={weekend.length}>
          {weekend.length === 0 ? <Empty msg="No Saturday/Sunday-dated expenses — nothing unusual." /> : (
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {weekend.slice(0, 15).map((w: any) => (
                    <tr key={w.id} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                      <Td mono>{formatDate(w.date)}</Td>
                      <Td>{(w.description || '—').slice(0, 40)}</Td>
                      <Td right mono>{formatCurrency(w.amount)}</Td>
                      <Td right><button className="block-btn text-[10px]" onClick={() => open(w.id)}>View</button></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="Round Amounts, No Receipt (≥$100)" icon={<CircleDollarSign size={13} className="text-accent-warning" />} count={roundNums.length}>
          {roundNums.length === 0 ? <Empty msg="No suspiciously round receipt-less amounts — figures look like real charges." /> : (
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {roundNums.slice(0, 15).map((r: any) => (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                      <Td mono>{formatDate(r.date)}</Td>
                      <Td>{(r.description || '—').slice(0, 40)}</Td>
                      <Td right mono color="var(--color-accent-warning)">{formatCurrency(r.amount)}</Td>
                      <Td right><button className="block-btn text-[10px]" onClick={() => open(r.id)}>View</button></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      {/* ── 3. Tax ── */}
      <div className="grid md:grid-cols-2 gap-4">
        <Section title={`Deductible Split (${taxSplit?.year || new Date().getFullYear()})`} icon={<ShieldCheck size={13} className="text-accent-income" />}>
          {!taxSplit || taxSplit.total === 0 ? <Empty msg="No expenses this year yet." /> : (
            <div className="p-4">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="text-text-secondary">Deductible <strong className="font-mono">{formatCurrency(taxSplit.deductible)}</strong></span>
                <span className="text-text-secondary">Non-deductible <strong className="font-mono">{formatCurrency(taxSplit.nonDeductible)}</strong></span>
              </div>
              <div style={{ height: 10, background: 'var(--color-bg-tertiary)', borderRadius: 5, overflow: 'hidden', display: 'flex' }}>
                <div style={{ width: `${taxSplit.deductiblePct}%`, background: 'var(--cust-series-positive, var(--color-accent-income))' }} />
                <div style={{ flex: 1, background: 'var(--cust-series-neutral, var(--color-text-muted))' }} />
              </div>
              <div className="text-[10px] text-text-muted mt-1.5">{taxSplit.deductiblePct}% of {formatCurrency(taxSplit.total)} is tax-deductible</div>
            </div>
          )}
        </Section>

        <Section title="Deductions by Category (YTD)" icon={<ShieldCheck size={13} className="text-accent-income" />} count={taxByCat.length}>
          {taxByCat.length === 0 ? <Empty msg="No deductible expenses recorded this year." /> : (
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {taxByCat.slice(0, 12).map((t: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                      <Td>{t.category || 'Uncategorized'}</Td>
                      <Td right mono>{t.count}×</Td>
                      <Td right mono color="var(--color-accent-income)">{formatCurrency(t.deductible_total)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      {/* ── 4. Cross-module ── */}
      <div className="grid md:grid-cols-2 gap-4">
        <Section title="Billable by Client (uninvoiced potential)" icon={<Tag size={13} className="text-accent-blue" />} count={billable.length}>
          {billable.length === 0 ? <Empty msg="No billable expenses tagged to clients." /> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {billable.slice(0, 10).map((b: any, i: number) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                    <Td>{b.client_name || 'Unassigned'}</Td>
                    <Td right mono>{b.count}×</Td>
                    <Td right mono>{formatCurrency(b.total)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Project Budget Consumption" icon={<FolderKanban size={13} className="text-accent-blue" />} count={projects.length}>
          {projects.length === 0 ? <Empty msg="No project-linked expenses." /> : (
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: '1px solid var(--color-border-primary)' }}><Th>Project</Th><Th right>Spent</Th><Th right>Budget</Th><Th right>%</Th></tr></thead>
                <tbody>
                  {projects.slice(0, 10).map((p: any) => (
                    <tr key={p.id} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                      <Td>{p.project_name}</Td>
                      <Td right mono>{formatCurrency(p.total_spent)}</Td>
                      <Td right mono>{p.budget ? formatCurrency(p.budget) : '—'}</Td>
                      <Td right mono color={p.pct_of_budget > 100 ? 'var(--color-accent-expense)' : p.pct_of_budget > 80 ? 'var(--color-accent-warning)' : undefined}>
                        {p.pct_of_budget != null ? `${p.pct_of_budget}%` : '—'}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="Loan-Linked Expenses" icon={<Landmark size={13} className="text-accent-blue" />} count={loanLinked.length}>
          {loanLinked.length === 0 ? <Empty msg="No expenses linked to loans." /> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: '1px solid var(--color-border-primary)' }}><Th>Loan</Th><Th right>Expenses</Th><Th right>Total</Th><Th right>Interest</Th></tr></thead>
              <tbody>
                {loanLinked.map((l: any, i: number) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                    <Td>{l.loan_name}</Td>
                    <Td right mono>{l.expense_count}×</Td>
                    <Td right mono>{formatCurrency(l.total_amount)}</Td>
                    <Td right mono color="var(--color-accent-expense)">{formatCurrency(l.interest_total)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Department Spend (this month)" icon={<Tag size={13} className="text-accent-blue" />} count={deptSpend.length}>
          {deptSpend.length === 0 ? <Empty msg="No department-attributed spend this month." /> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {deptSpend.map((d: any, i: number) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                    <Td>{d.department}</Td>
                    <Td right mono>{formatCurrency(d.actual)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>

      {/* ── 5. Status + quarters + tags ── */}
      <div className="grid md:grid-cols-3 gap-4">
        <Section title="By Status" icon={<AlertTriangle size={13} className="text-accent-blue" />}>
          {byStatus.length === 0 ? <Empty msg="No data." /> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {byStatus.map((s: any, i: number) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                    <Td>{String(s.status || 'unknown').replace(/_/g, ' ')}</Td>
                    <Td right mono>{s.count}×</Td>
                    <Td right mono>{formatCurrency(s.total)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="By Quarter (24mo)" icon={<AlertTriangle size={13} className="text-accent-blue" />}>
          {quarters.length === 0 ? <Empty msg="No data." /> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {quarters.slice(-8).reverse().map((q: any) => (
                  <tr key={q.quarter} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                    <Td mono>{q.quarter}</Td>
                    <Td right mono>{q.count}×</Td>
                    <Td right mono>{formatCurrency(q.total)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="By Tag" icon={<Tag size={13} className="text-accent-blue" />} count={tags.length}>
          {tags.length === 0 ? <Empty msg="No tagged expenses." /> : (
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {tags.slice(0, 12).map((t: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                      <Td>{t.tag_name}</Td>
                      <Td right mono>{t.expense_count}×</Td>
                      <Td right mono>{formatCurrency(t.total)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
};

export default ExpenseCompliance;
