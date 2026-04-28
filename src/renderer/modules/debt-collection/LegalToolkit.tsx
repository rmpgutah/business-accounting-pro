import React, { useEffect, useState, useCallback } from 'react';
import { FileText, Gavel, Clock, Scale, Package, DollarSign, Printer, Calculator, Link2, Users, Activity } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate, formatStatus } from '../../lib/format';
import DemandLetterGenerator from './DemandLetterGenerator';
import CourtFilingTracker from './CourtFilingTracker';
import StatuteTracker from './StatuteTracker';
import BundleExport from './BundleExport';
import ErrorBanner from '../../components/ErrorBanner';

// ─── Types ──────────────────────────────────────────────
type SubTab = 'evidence' | 'demand_letters' | 'court_filings' | 'statute_tracker' | 'bundle' | 'audit_trail' | 'court_packet' | 'litigation_costs' | 'judgments' | 'garnishment' | 'liens' | 'legal_timeline' | 'attorneys' | 'print_summary';

interface LegalToolkitProps {
  onOpenEvidence: () => void;
}

interface DebtOption {
  id: string;
  debtor_name: string;
  balance_due: number;
  status: string;
}

// ─── Sub-Tab Button ─────────────────────────────────────
const SubTabBtn: React.FC<{
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}> = ({ active, icon, label, onClick }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold transition-colors ${
      active
        ? 'bg-bg-tertiary text-text-primary border-b-2 border-accent-blue'
        : 'text-text-muted hover:text-text-secondary transition-colors'
    }`}
    style={{ borderRadius: '6px 6px 0 0' }}
  >
    {icon}
    {label}
  </button>
);

// ─── Audit Trail View ──────────────────────────────────
const AuditTrailView: React.FC<{ debtId: string }> = ({ debtId }) => {
  const [entries, setEntries] = useState<any[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.debtAuditLog(debtId, 500).then(r => {
      setEntries(Array.isArray(r) ? r : []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [debtId]);

  const filtered = filter
    ? entries.filter(e => e.action.includes(filter) || (e.field_name || '').includes(filter) || (e.new_value || '').toLowerCase().includes(filter.toLowerCase()))
    : entries;

  if (loading) return <div className="text-text-muted text-sm text-center py-8">Loading audit trail...</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <input
          className="block-input flex-1"
          placeholder="Filter by action, field, or value..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="text-xs text-text-muted">{filtered.length} entries</span>
      </div>
      {filtered.length === 0 ? (
        <div className="text-text-muted text-sm text-center py-8">No audit entries{filter ? ' matching filter' : ''}.</div>
      ) : (
        <div className="space-y-1 max-h-[60vh] overflow-y-auto">
          {filtered.map((entry: any) => {
            const labels: Record<string, string> = {
              stage_advance: 'Stage Advanced', hold_toggle: 'Hold Toggled', assignment_change: 'Collector Assigned',
              fee_added: 'Fee Added', settlement_accepted: 'Settlement Accepted', settlement_offered: 'Settlement Offered',
              compliance_event: 'Compliance Event', plan_created: 'Plan Created', promise_recorded: 'Promise Recorded',
              promise_updated: 'Promise Updated', note_added: 'Note Added', field_edit: 'Field Updated',
              payment_recorded: 'Payment Recorded', communication_logged: 'Communication Logged',
              dispute_filed: 'Dispute Filed', record_deleted: 'Record Deleted', interest_recalculated: 'Interest Recalculated',
            };
            return (
              <div key={entry.id} className="flex items-start gap-3 px-3 py-2 border-l-2 border-border-primary text-xs hover:bg-bg-hover transition-colors" style={{ borderRadius: '0 6px 6px 0' }}>
                <span className="text-text-muted font-mono whitespace-nowrap">{formatDate(entry.performed_at, { style: 'short' })}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-text-primary font-semibold">{labels[entry.action] || entry.action}</span>
                  {entry.field_name && <span className="text-text-muted ml-1">({entry.field_name})</span>}
                  {entry.old_value && entry.new_value && <span className="text-text-muted ml-1">{entry.old_value} → {entry.new_value}</span>}
                  {!entry.old_value && entry.new_value && <span className="text-text-muted ml-1">: {entry.new_value}</span>}
                </div>
                <span className="text-[10px] text-text-muted capitalize flex-shrink-0">{entry.performed_by}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ─── Feature 49: Litigation Cost Tracker ────────────────
const LitigationCostTracker: React.FC<{ companyId: string }> = ({ companyId }) => {
  const [debts, setDebts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await api.rawQuery(
          `SELECT d.id, d.debtor_name, d.original_amount,
            COALESCE(d.collection_costs, 0) as legal_costs,
            COALESCE(d.amount_paid, 0) as recovered,
            d.status
          FROM debts d WHERE d.company_id = ? AND d.status IN ('legal','in_collection','active')
          ORDER BY legal_costs DESC`,
          [companyId]
        );
        setDebts(Array.isArray(res) ? res : []);
      } catch (_) { setDebts([]); }
      setLoading(false);
    };
    load();
  }, [companyId]);

  if (loading) return <div className="text-text-muted text-sm text-center py-8">Loading litigation costs...</div>;

  const totalCosts = debts.reduce((s, d) => s + (d.legal_costs || 0), 0);
  const totalRecovered = debts.reduce((s, d) => s + (d.recovered || 0), 0);
  const netRoi = totalCosts > 0 ? Math.round(((totalRecovered - totalCosts) / totalCosts) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="block-card p-4 text-center" style={{ borderRadius: 6 }}>
          <div className="text-lg font-mono font-bold text-accent-expense">{formatCurrency(totalCosts)}</div>
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Total Legal Costs</div>
        </div>
        <div className="block-card p-4 text-center" style={{ borderRadius: 6 }}>
          <div className="text-lg font-mono font-bold text-accent-income">{formatCurrency(totalRecovered)}</div>
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Total Recovered</div>
        </div>
        <div className="block-card p-4 text-center" style={{ borderRadius: 6 }}>
          <div className={`text-lg font-mono font-bold ${netRoi >= 0 ? 'text-accent-income' : 'text-accent-expense'}`}>{netRoi}%</div>
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">ROI</div>
        </div>
      </div>
      {/* Per-Debt Table */}
      {debts.length === 0 ? (
        <div className="text-text-muted text-xs text-center py-4">No debts with legal costs tracked.</div>
      ) : (
        <table className="block-table">
          <thead>
            <tr>
              <th>Debtor</th>
              <th className="text-right">Original</th>
              <th className="text-right">Legal Costs</th>
              <th className="text-right">Recovered</th>
              <th className="text-right">Net</th>
              <th className="text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {debts.map((d: any) => {
              const net = (d.recovered || 0) - (d.legal_costs || 0);
              const st = formatStatus(d.status);
              return (
                <tr key={d.id}>
                  <td className="text-text-primary font-medium text-sm">{d.debtor_name}</td>
                  <td className="text-right font-mono text-sm text-text-secondary">{formatCurrency(d.original_amount)}</td>
                  <td className="text-right font-mono text-sm text-accent-expense">{formatCurrency(d.legal_costs)}</td>
                  <td className="text-right font-mono text-sm text-accent-income">{formatCurrency(d.recovered)}</td>
                  <td className={`text-right font-mono text-sm font-bold ${net >= 0 ? 'text-accent-income' : 'text-accent-expense'}`}>{formatCurrency(net)}</td>
                  <td className="text-center">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 ${st.className}`} style={{ borderRadius: 4 }}>{st.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};

// ─── Feature 50: Judgment Tracking ──────────────────────
const JudgmentTracking: React.FC<{ companyId: string }> = ({ companyId }) => {
  const [judgments, setJudgments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await api.rawQuery(
          `SELECT d.id, d.debtor_name, d.original_amount, d.balance_due,
            COALESCE(d.judgment_date, '') as judgment_date,
            COALESCE(d.judgment_amount, d.original_amount) as judgment_amount,
            COALESCE(d.post_judgment_interest_rate, 0) as interest_rate,
            CASE WHEN d.judgment_date IS NOT NULL AND d.post_judgment_interest_rate > 0
              THEN ROUND(COALESCE(d.judgment_amount, d.original_amount) * (d.post_judgment_interest_rate / 100.0) * (julianday('now') - julianday(d.judgment_date)) / 365.0, 2)
              ELSE 0
            END as accrued_interest
          FROM debts d WHERE d.company_id = ? AND (d.status = 'legal' OR d.judgment_date IS NOT NULL)
          ORDER BY d.judgment_date DESC`,
          [companyId]
        );
        setJudgments(Array.isArray(res) ? res : []);
      } catch (_) { setJudgments([]); }
      setLoading(false);
    };
    load();
  }, [companyId]);

  if (loading) return <div className="text-text-muted text-sm text-center py-8">Loading judgments...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Gavel size={16} className="text-accent-blue" />
        <h4 className="text-sm font-semibold text-text-primary">Judgment Tracking</h4>
        <span className="text-xs text-text-muted ml-auto">{judgments.length} judgments</span>
      </div>
      {judgments.length === 0 ? (
        <div className="text-text-muted text-xs text-center py-8">No judgments recorded.</div>
      ) : (
        <table className="block-table">
          <thead>
            <tr>
              <th>Debtor</th>
              <th className="text-right">Judgment Date</th>
              <th className="text-right">Judgment Amt</th>
              <th className="text-right">Interest Rate</th>
              <th className="text-right">Accrued Interest</th>
              <th className="text-right">Current Balance</th>
            </tr>
          </thead>
          <tbody>
            {judgments.map((j: any) => {
              const currentBal = (j.judgment_amount || 0) + (j.accrued_interest || 0) - ((j.original_amount || 0) - (j.balance_due || 0));
              return (
                <tr key={j.id}>
                  <td className="text-text-primary font-medium text-sm">{j.debtor_name}</td>
                  <td className="text-right font-mono text-sm text-text-secondary">{j.judgment_date || 'Pending'}</td>
                  <td className="text-right font-mono text-sm">{formatCurrency(j.judgment_amount)}</td>
                  <td className="text-right font-mono text-sm text-text-secondary">{j.interest_rate > 0 ? `${j.interest_rate}%` : '-'}</td>
                  <td className="text-right font-mono text-sm text-accent-expense">{j.accrued_interest > 0 ? formatCurrency(j.accrued_interest) : '-'}</td>
                  <td className="text-right font-mono text-sm font-bold text-text-primary">{formatCurrency(Math.max(currentBal, 0))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};

// ─── Feature 51: Garnishment Calculator ─────────────────
const GarnishmentCalculator: React.FC = () => {
  const [judgmentAmount, setJudgmentAmount] = useState('');
  const [weeklyIncome, setWeeklyIncome] = useState('');
  const [deductions, setDeductions] = useState('');
  const [result, setResult] = useState<{ maxGarnishment: number; method: string } | null>(null);

  const FEDERAL_MIN_WAGE = 7.25;

  const calculate = () => {
    const judgment = parseFloat(judgmentAmount) || 0;
    const weekly = parseFloat(weeklyIncome) || 0;
    const deduct = parseFloat(deductions) || 0;
    if (weekly <= 0 || judgment <= 0) {
      setResult(null);
      return;
    }

    const disposable = weekly - deduct;
    // Federal garnishment limits: lesser of 25% disposable earnings OR amount exceeding 30x federal min wage
    const method1 = disposable * 0.25; // 25% of disposable
    const method2 = Math.max(disposable - (30 * FEDERAL_MIN_WAGE), 0); // Amount exceeding 30x min wage
    const maxWeekly = Math.min(method1, method2);

    setResult({
      maxGarnishment: Math.max(maxWeekly, 0),
      method: method1 <= method2 ? '25% of disposable earnings' : `Amount exceeding 30x federal minimum wage ($${(30 * FEDERAL_MIN_WAGE).toFixed(2)}/week)`,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Calculator size={16} className="text-accent-blue" />
        <h4 className="text-sm font-semibold text-text-primary">Federal Garnishment Calculator</h4>
      </div>
      <div className="text-xs text-text-muted p-3 bg-bg-tertiary" style={{ borderRadius: 6 }}>
        Per CCPA (15 U.S.C. 1673): Maximum garnishment is the lesser of 25% of disposable earnings OR the amount by which disposable weekly earnings exceed 30 times the federal minimum wage (${FEDERAL_MIN_WAGE}/hr).
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Judgment Amount</label>
          <input
            type="number"
            className="block-input"
            placeholder="$0.00"
            value={judgmentAmount}
            onChange={(e) => setJudgmentAmount(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Weekly Gross Income</label>
          <input
            type="number"
            className="block-input"
            placeholder="$0.00"
            value={weeklyIncome}
            onChange={(e) => setWeeklyIncome(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Weekly Deductions</label>
          <input
            type="number"
            className="block-input"
            placeholder="$0.00 (taxes, etc.)"
            value={deductions}
            onChange={(e) => setDeductions(e.target.value)}
          />
        </div>
      </div>
      <button className="block-btn-primary text-xs py-1.5 px-4" style={{ borderRadius: 6 }} onClick={calculate}>
        Calculate Maximum Garnishment
      </button>
      {result && (
        <div className="block-card p-4 space-y-3" style={{ borderRadius: 6 }}>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Max Weekly Garnishment</div>
              <div className="text-2xl font-mono font-bold text-accent-blue">{formatCurrency(result.maxGarnishment)}</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Max Monthly (est.)</div>
              <div className="text-2xl font-mono font-bold text-text-primary">{formatCurrency(result.maxGarnishment * 4.33)}</div>
            </div>
          </div>
          <div className="text-xs text-text-muted">
            Limiting factor: <strong className="text-text-secondary">{result.method}</strong>
          </div>
          {parseFloat(judgmentAmount) > 0 && result.maxGarnishment > 0 && (
            <div className="text-xs text-text-muted">
              Estimated weeks to satisfy judgment: <strong className="text-text-secondary">{Math.ceil(parseFloat(judgmentAmount) / result.maxGarnishment)}</strong>
              {' '}({Math.ceil(parseFloat(judgmentAmount) / result.maxGarnishment / 4.33)} months)
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Feature 52: Lien Filing Status ─────────────────────
const LienFilingStatus: React.FC<{ companyId: string }> = ({ companyId }) => {
  const [liens, setLiens] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await api.rawQuery(
          `SELECT la.id, d.debtor_name, la.action_type, la.description, la.filing_date, la.status, la.amount,
            d.id as debt_id
          FROM debt_legal_actions la
          JOIN debts d ON la.debt_id = d.id
          WHERE d.company_id = ? AND la.action_type IN ('property_lien','bank_levy','wage_garnishment','lien','levy')
          ORDER BY la.filing_date DESC`,
          [companyId]
        );
        setLiens(Array.isArray(res) ? res : []);
      } catch (_) { setLiens([]); }
      setLoading(false);
    };
    load();
  }, [companyId]);

  if (loading) return <div className="text-text-muted text-sm text-center py-8">Loading lien data...</div>;

  const typeLabels: Record<string, string> = {
    property_lien: 'Property Lien',
    bank_levy: 'Bank Levy',
    wage_garnishment: 'Wage Garnishment',
    lien: 'Lien',
    levy: 'Levy',
  };

  const statusColor = (s: string) => {
    if (s === 'active' || s === 'filed') return 'text-accent-income bg-accent-income/10';
    if (s === 'pending') return 'text-yellow-500 bg-yellow-500/10';
    if (s === 'released' || s === 'satisfied') return 'text-text-muted bg-bg-tertiary';
    return 'text-text-secondary bg-bg-tertiary';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link2 size={16} className="text-accent-blue" />
        <h4 className="text-sm font-semibold text-text-primary">Lien Filing Status</h4>
        <span className="text-xs text-text-muted ml-auto">{liens.length} filings</span>
      </div>
      {liens.length === 0 ? (
        <div className="text-text-muted text-xs text-center py-8">No lien filings recorded. Lien data comes from the Legal Actions log.</div>
      ) : (
        <table className="block-table">
          <thead>
            <tr>
              <th>Debtor</th>
              <th>Type</th>
              <th className="text-right">Amount</th>
              <th>Filing Date</th>
              <th className="text-center">Status</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {liens.map((l: any) => (
              <tr key={l.id}>
                <td className="text-text-primary font-medium text-sm">{l.debtor_name}</td>
                <td className="text-sm text-text-secondary">{typeLabels[l.action_type] || l.action_type}</td>
                <td className="text-right font-mono text-sm">{l.amount ? formatCurrency(l.amount) : '-'}</td>
                <td className="text-sm text-text-secondary font-mono">{l.filing_date || '-'}</td>
                <td className="text-center">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 ${statusColor(l.status)}`} style={{ borderRadius: 4 }}>
                    {(l.status || 'unknown').toUpperCase()}
                  </span>
                </td>
                <td className="text-xs text-text-muted max-w-[200px] truncate">{l.description || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

// ─── Feature 53: Legal Timeline ─────────────────────────
const LegalTimeline: React.FC<{ debtId: string }> = ({ debtId }) => {
  const [actions, setActions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await api.rawQuery(
          `SELECT id, action_type, description, filing_date, status, COALESCE(amount, 0) as amount, created_at
          FROM debt_legal_actions WHERE debt_id = ?
          ORDER BY COALESCE(filing_date, created_at) DESC`,
          [debtId]
        );
        setActions(Array.isArray(res) ? res : []);
      } catch (_) { setActions([]); }
      setLoading(false);
    };
    load();
  }, [debtId]);

  if (loading) return <div className="text-text-muted text-sm text-center py-8">Loading legal timeline...</div>;

  const typeIcons: Record<string, string> = {
    demand_letter: 'Letter',
    complaint_filed: 'Filing',
    summons_served: 'Service',
    default_judgment: 'Judgment',
    hearing: 'Hearing',
    property_lien: 'Lien',
    bank_levy: 'Levy',
    wage_garnishment: 'Garnishment',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Activity size={16} className="text-accent-blue" />
        <h4 className="text-sm font-semibold text-text-primary">Legal Timeline</h4>
        <span className="text-xs text-text-muted ml-auto">{actions.length} actions</span>
      </div>
      {actions.length === 0 ? (
        <div className="text-text-muted text-xs text-center py-8">No legal actions recorded for this debt.</div>
      ) : (
        <div className="space-y-1 max-h-[60vh] overflow-y-auto">
          {actions.map((a: any, i: number) => (
            <div
              key={a.id}
              className="flex items-start gap-3 px-3 py-3 border-l-2 border-accent-blue hover:bg-bg-hover transition-colors"
              style={{ borderRadius: '0 6px 6px 0' }}
            >
              <div className="flex-shrink-0 text-center" style={{ minWidth: 80 }}>
                <div className="text-xs font-mono text-text-muted">{a.filing_date || formatDate(a.created_at, { style: 'short' })}</div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-text-primary">
                    {typeIcons[a.action_type] || a.action_type?.replace(/_/g, ' ')}
                  </span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 ${
                    a.status === 'completed' ? 'text-accent-income bg-accent-income/10' :
                    a.status === 'pending' ? 'text-yellow-500 bg-yellow-500/10' :
                    'text-text-muted bg-bg-tertiary'
                  }`} style={{ borderRadius: 4 }}>
                    {(a.status || 'pending').toUpperCase()}
                  </span>
                  {a.amount > 0 && (
                    <span className="text-xs font-mono text-text-secondary ml-auto">{formatCurrency(a.amount)}</span>
                  )}
                </div>
                {a.description && (
                  <div className="text-[11px] text-text-muted mt-1">{a.description}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Feature 54: Attorney Assignment ────────────────────
const AttorneyAssignment: React.FC<{ companyId: string }> = ({ companyId }) => {
  const [attorneys, setAttorneys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        // Get debts in legal status and their assigned attorneys
        const res = await api.rawQuery(
          `SELECT d.id, d.debtor_name, d.balance_due, d.status,
            COALESCE(d.assigned_attorney, '') as attorney_name,
            COALESCE(d.attorney_email, '') as attorney_email,
            COALESCE(d.attorney_phone, '') as attorney_phone,
            COALESCE(d.attorney_fee_type, '') as fee_type,
            COALESCE(d.attorney_fee_amount, 0) as fee_amount,
            COALESCE(d.collection_costs, 0) as legal_costs
          FROM debts d WHERE d.company_id = ? AND d.status IN ('legal','in_collection')
          ORDER BY d.assigned_attorney, d.debtor_name`,
          [companyId]
        );
        setAttorneys(Array.isArray(res) ? res : []);
      } catch (_) { setAttorneys([]); }
      setLoading(false);
    };
    load();
  }, [companyId]);

  if (loading) return <div className="text-text-muted text-sm text-center py-8">Loading attorney assignments...</div>;

  // Group by attorney
  const grouped: Record<string, any[]> = {};
  attorneys.forEach((a: any) => {
    const key = a.attorney_name || 'Unassigned';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(a);
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Users size={16} className="text-accent-blue" />
        <h4 className="text-sm font-semibold text-text-primary">Attorney Assignments</h4>
        <span className="text-xs text-text-muted ml-auto">{attorneys.length} debts in legal</span>
      </div>
      {Object.keys(grouped).length === 0 ? (
        <div className="text-text-muted text-xs text-center py-8">No debts in legal status.</div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([attorney, debts]) => {
            const first = debts[0];
            const totalBalance = debts.reduce((s, d) => s + (d.balance_due || 0), 0);
            const totalCosts = debts.reduce((s, d) => s + (d.legal_costs || 0), 0);
            return (
              <div key={attorney} className="block-card p-4" style={{ borderRadius: 6 }}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="text-sm font-semibold text-text-primary">{attorney}</div>
                    {first.attorney_email && <div className="text-[11px] text-text-muted">{first.attorney_email}</div>}
                    {first.attorney_phone && <div className="text-[11px] text-text-muted">{first.attorney_phone}</div>}
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-text-muted">{debts.length} case{debts.length !== 1 ? 's' : ''}</div>
                    {first.fee_type && (
                      <div className="text-[10px] text-text-muted">
                        Fee: {first.fee_type === 'contingency' ? `${first.fee_amount}% contingency` : first.fee_type === 'flat' ? formatCurrency(first.fee_amount) : `${formatCurrency(first.fee_amount)}/hr`}
                      </div>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="text-center p-2 bg-bg-tertiary" style={{ borderRadius: 6 }}>
                    <div className="text-sm font-mono font-bold text-text-primary">{formatCurrency(totalBalance)}</div>
                    <div className="text-[10px] text-text-muted">Total Balance</div>
                  </div>
                  <div className="text-center p-2 bg-bg-tertiary" style={{ borderRadius: 6 }}>
                    <div className="text-sm font-mono font-bold text-accent-expense">{formatCurrency(totalCosts)}</div>
                    <div className="text-[10px] text-text-muted">Legal Costs</div>
                  </div>
                </div>
                <div className="space-y-1">
                  {debts.map((d: any) => (
                    <div key={d.id} className="flex justify-between text-xs px-2 py-1 hover:bg-bg-hover transition-colors" style={{ borderRadius: 6 }}>
                      <span className="text-text-secondary">{d.debtor_name}</span>
                      <span className="font-mono text-text-primary">{formatCurrency(d.balance_due)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ─── Feature 55: Print Legal Summary ────────────────────
const PrintLegalSummary: React.FC<{ companyId: string }> = ({ companyId }) => {
  const [printing, setPrinting] = useState(false);

  const handlePrint = async () => {
    setPrinting(true);
    try {
      const debts = await api.rawQuery(
        `SELECT d.id, d.debtor_name, d.original_amount, d.balance_due, d.status,
          COALESCE(d.collection_costs, 0) as legal_costs,
          COALESCE(d.amount_paid, 0) as recovered,
          COALESCE(d.judgment_date, '') as judgment_date,
          COALESCE(d.judgment_amount, 0) as judgment_amount,
          COALESCE(d.assigned_attorney, 'Unassigned') as attorney,
          COALESCE(d.statute_of_limitations_date, '') as sol_date
        FROM debts d WHERE d.company_id = ? AND d.status IN ('legal','in_collection','active')
        ORDER BY d.status, d.debtor_name`,
        [companyId]
      );
      const data = Array.isArray(debts) ? debts : [];
      const totalOriginal = data.reduce((s: number, d: any) => s + (d.original_amount || 0), 0);
      const totalBalance = data.reduce((s: number, d: any) => s + (d.balance_due || 0), 0);
      const totalCosts = data.reduce((s: number, d: any) => s + (d.legal_costs || 0), 0);
      const totalRecovered = data.reduce((s: number, d: any) => s + (d.recovered || 0), 0);

      const sections: string[] = [];
      sections.push('<h2>Legal Portfolio Summary</h2>');
      sections.push(`<p style="color:#666;">Generated: ${new Date().toLocaleString()}</p>`);

      sections.push('<h3>Portfolio Overview</h3>');
      sections.push(`<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px;">
        <tr><td style="padding:4px 8px;font-weight:600;">Total Debts:</td><td>${data.length}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:600;">Total Original Amount:</td><td>${formatCurrency(totalOriginal)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:600;">Total Balance Due:</td><td>${formatCurrency(totalBalance)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:600;">Total Legal Costs:</td><td>${formatCurrency(totalCosts)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:600;">Total Recovered:</td><td>${formatCurrency(totalRecovered)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:600;">Net ROI:</td><td>${totalCosts > 0 ? Math.round(((totalRecovered - totalCosts) / totalCosts) * 100) : 0}%</td></tr>
      </table>`);

      sections.push('<h3>Debt Detail</h3>');
      sections.push('<table style="width:100%;border-collapse:collapse;font-size:10px;"><thead><tr>');
      ['Debtor', 'Status', 'Original', 'Balance', 'Legal Costs', 'Recovered', 'Attorney', 'Judgment', 'SOL Date'].forEach(h => {
        sections.push(`<th style="text-align:left;padding:4px 6px;border-bottom:2px solid #333;font-weight:600;">${h}</th>`);
      });
      sections.push('</tr></thead><tbody>');
      data.forEach((d: any, i: number) => {
        sections.push(`<tr style="background:${i % 2 ? '#f9f9f9' : '#fff'}">
          <td style="padding:4px 6px;border-bottom:1px solid #eee;">${d.debtor_name}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;">${d.status}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;">${formatCurrency(d.original_amount)}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;">${formatCurrency(d.balance_due)}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;">${formatCurrency(d.legal_costs)}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;">${formatCurrency(d.recovered)}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;">${d.attorney}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;">${d.judgment_date ? `${d.judgment_date} (${formatCurrency(d.judgment_amount)})` : '-'}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;">${d.sol_date || '-'}</td>
        </tr>`);
      });
      sections.push('</tbody></table>');

      const html = `<!DOCTYPE html><html><head><title>Legal Portfolio Summary</title><style>body{font-family:-apple-system,sans-serif;padding:32px;color:#111;}h2{margin-bottom:4px;}h3{margin-top:20px;margin-bottom:8px;border-bottom:1px solid #ddd;padding-bottom:4px;}</style></head><body>${sections.join('\n')}<div style="margin-top:32px;font-size:10px;color:#999;border-top:1px solid #eee;padding-top:8px;">Legal Portfolio Summary — Confidential — ${new Date().toLocaleString()}</div></body></html>`;
      await api.printPreview(html, 'Legal Portfolio Summary');
    } catch (err) {
      console.error('Failed to generate legal summary:', err);
    }
    setPrinting(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Printer size={16} className="text-accent-blue" />
        <h4 className="text-sm font-semibold text-text-primary">Print Legal Summary</h4>
      </div>
      <div className="block-card p-6 text-center" style={{ borderRadius: 6 }}>
        <Scale size={32} className="mx-auto text-text-muted mb-3" />
        <p className="text-text-secondary text-sm mb-4">
          Generate a comprehensive legal portfolio summary including all debts in collection or legal status, costs, judgments, garnishment status, and attorney assignments.
        </p>
        <button
          className="block-btn-primary flex items-center gap-2 mx-auto"
          onClick={handlePrint}
          disabled={printing}
        >
          <Printer size={14} />
          {printing ? 'Generating...' : 'Generate Legal Summary'}
        </button>
      </div>
    </div>
  );
};

// ─── Component ──────────────────────────────────────────
const LegalToolkit: React.FC<LegalToolkitProps> = ({ onOpenEvidence }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [subTab, setSubTab] = useState<SubTab>('demand_letters');
  const [debts, setDebts] = useState<DebtOption[]>([]);
  const [selectedDebtId, setSelectedDebtId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // ── Load debts in collection/legal status ──
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      setLoading(true);
      setError('');
      try {
        const data = await api.rawQuery(
          "SELECT id, debtor_name, balance_due, status FROM debts WHERE company_id = ? AND status IN ('active','in_collection','legal','disputed') ORDER BY debtor_name",
          [activeCompany.id]
        );
        if (cancelled) return;
        setDebts(Array.isArray(data) ? data : []);
      } catch (err: any) {
        console.error('Failed to load debts for legal toolkit:', err);
        if (!cancelled) setError(err?.message || 'Failed to load debts for legal toolkit');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeCompany]);

  const handleDebtChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedDebtId(e.target.value);
  }, []);

  // Tabs that require a debt selection vs company-level tabs
  const debtRequiredTabs: SubTab[] = ['demand_letters', 'court_filings', 'bundle', 'audit_trail', 'court_packet', 'legal_timeline'];
  const companyLevelTabs: SubTab[] = ['litigation_costs', 'judgments', 'liens', 'attorneys', 'print_summary', 'garnishment'];
  const noDebtTabs: SubTab[] = ['evidence', 'statute_tracker', ...companyLevelTabs];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading Legal Toolkit...
      </div>
    );
  }

  return (
    <div>
      {error && <ErrorBanner message={error} title="Failed to load debts for legal toolkit" onDismiss={() => setError('')} />}
      {/* Debt Selector */}
      <div className="block-card mb-4">
        <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
          Select Debt
        </label>
        <select
          className="block-select w-full"
          value={selectedDebtId}
          onChange={handleDebtChange}
        >
          <option value="">-- Select a debt --</option>
          {debts.map((d) => {
            const st = formatStatus(d.status);
            return (
              <option key={d.id} value={d.id}>
                {d.debtor_name} - {formatCurrency(d.balance_due)} ({st.label})
              </option>
            );
          })}
        </select>
      </div>

      {/* Sub-tab bar — two rows for the expanded tabs */}
      <div className="border-b border-border-primary mb-4">
        <div className="flex cursor-pointer overflow-x-auto">
          <SubTabBtn active={subTab === 'demand_letters'} icon={<FileText size={14} />} label="Demand Letters" onClick={() => setSubTab('demand_letters')} />
          <SubTabBtn active={subTab === 'court_filings'} icon={<Gavel size={14} />} label="Court Filings" onClick={() => setSubTab('court_filings')} />
          <SubTabBtn active={subTab === 'statute_tracker'} icon={<Clock size={14} />} label="Statute Tracker" onClick={() => setSubTab('statute_tracker')} />
          <SubTabBtn active={subTab === 'evidence'} icon={<Scale size={14} />} label="Evidence" onClick={() => setSubTab('evidence')} />
          <SubTabBtn active={subTab === 'bundle'} icon={<Package size={14} />} label="Export Bundle" onClick={() => setSubTab('bundle')} />
          <SubTabBtn active={subTab === 'audit_trail'} icon={<Clock size={14} />} label="Audit Trail" onClick={() => setSubTab('audit_trail')} />
          <SubTabBtn active={subTab === 'court_packet'} icon={<Scale size={14} />} label="Court Packet" onClick={() => setSubTab('court_packet')} />
        </div>
        <div className="flex cursor-pointer overflow-x-auto">
          <SubTabBtn active={subTab === 'litigation_costs'} icon={<DollarSign size={14} />} label="Litigation Costs" onClick={() => setSubTab('litigation_costs')} />
          <SubTabBtn active={subTab === 'judgments'} icon={<Gavel size={14} />} label="Judgments" onClick={() => setSubTab('judgments')} />
          <SubTabBtn active={subTab === 'garnishment'} icon={<Calculator size={14} />} label="Garnishment Calc" onClick={() => setSubTab('garnishment')} />
          <SubTabBtn active={subTab === 'liens'} icon={<Link2 size={14} />} label="Liens" onClick={() => setSubTab('liens')} />
          <SubTabBtn active={subTab === 'legal_timeline'} icon={<Activity size={14} />} label="Legal Timeline" onClick={() => setSubTab('legal_timeline')} />
          <SubTabBtn active={subTab === 'attorneys'} icon={<Users size={14} />} label="Attorneys" onClick={() => setSubTab('attorneys')} />
          <SubTabBtn active={subTab === 'print_summary'} icon={<Printer size={14} />} label="Print Summary" onClick={() => setSubTab('print_summary')} />
        </div>
      </div>

      {/* Content */}
      {subTab === 'evidence' && (
        <div className="block-card text-center py-8">
          <Scale size={32} className="mx-auto text-text-muted mb-3" />
          <p className="text-text-muted text-sm mb-4">
            Open the Evidence panel from a debt detail view to manage evidence items.
          </p>
          <button className="block-btn-primary" onClick={onOpenEvidence}>
            Open Evidence Panel
          </button>
        </div>
      )}

      {subTab === 'statute_tracker' && activeCompany && (
        <StatuteTracker companyId={activeCompany.id} />
      )}

      {/* Debt-required tabs without a debt selected */}
      {!selectedDebtId && debtRequiredTabs.includes(subTab) && (
        <div className="block-card text-center py-12">
          <Gavel size={32} className="mx-auto text-text-muted mb-3" />
          <p className="text-text-muted text-sm">
            Select a debt above to use this tool.
          </p>
        </div>
      )}

      {selectedDebtId && subTab === 'demand_letters' && (
        <DemandLetterGenerator debtId={selectedDebtId} />
      )}

      {selectedDebtId && subTab === 'court_filings' && (
        <CourtFilingTracker debtId={selectedDebtId} />
      )}

      {selectedDebtId && subTab === 'bundle' && (
        <BundleExport debtId={selectedDebtId} />
      )}

      {subTab === 'audit_trail' && selectedDebtId && (
        <AuditTrailView debtId={selectedDebtId} />
      )}

      {subTab === 'court_packet' && selectedDebtId && (
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Generate a comprehensive court-ready document package for the selected debt.
            The packet includes all communications, payments, evidence, compliance records,
            audit trail, settlements, contacts, and disputes.
          </p>
          <div className="flex gap-3">
            <button
              className="block-btn-primary flex items-center gap-2"
              onClick={async () => {
                const data = await api.generateCourtPacket(selectedDebtId);
                if (data?.error) return;
                const { generateCourtPacketHTML } = await import('../../lib/print-templates');
                const html = generateCourtPacketHTML(data);
                await api.printPreview(html, 'Court Packet');
              }}
            >
              <Scale size={14} />
              Generate Court Packet
            </button>
            <button
              className="block-btn flex items-center gap-2"
              onClick={async () => {
                const debt = await api.get('debts', selectedDebtId);
                if (!debt) return;
                const { generateVerificationAffidavitHTML } = await import('../../lib/print-templates');
                const html = generateVerificationAffidavitHTML(debt, activeCompany, '');
                await api.printPreview(html, 'Verification Affidavit');
              }}
            >
              <FileText size={14} />
              Generate Affidavit
            </button>
          </div>
        </div>
      )}

      {/* ── Feature 49: Litigation Cost Tracker ── */}
      {subTab === 'litigation_costs' && activeCompany && (
        <LitigationCostTracker companyId={activeCompany.id} />
      )}

      {/* ── Feature 50: Judgment Tracking ── */}
      {subTab === 'judgments' && activeCompany && (
        <JudgmentTracking companyId={activeCompany.id} />
      )}

      {/* ── Feature 51: Garnishment Calculator ── */}
      {subTab === 'garnishment' && (
        <GarnishmentCalculator />
      )}

      {/* ── Feature 52: Lien Filing Status ── */}
      {subTab === 'liens' && activeCompany && (
        <LienFilingStatus companyId={activeCompany.id} />
      )}

      {/* ── Feature 53: Legal Timeline (per-debt) ── */}
      {subTab === 'legal_timeline' && selectedDebtId && (
        <LegalTimeline debtId={selectedDebtId} />
      )}

      {/* ── Feature 54: Attorney Assignment ── */}
      {subTab === 'attorneys' && activeCompany && (
        <AttorneyAssignment companyId={activeCompany.id} />
      )}

      {/* ── Feature 55: Print Legal Summary ── */}
      {subTab === 'print_summary' && activeCompany && (
        <PrintLegalSummary companyId={activeCompany.id} />
      )}
    </div>
  );
};

export default LegalToolkit;
