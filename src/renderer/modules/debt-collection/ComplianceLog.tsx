import React, { useEffect, useState } from 'react';
import { ShieldCheck, Plus, AlertTriangle, Pencil, Trash2, Printer, Clock, FileCheck, Activity, CheckCircle, XCircle } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import { useCompanyStore } from '../../stores/companyStore';

const EVENT_LABELS: Record<string, string> = {
  validation_notice_sent: 'Validation Notice Sent',
  dispute_received: 'Dispute Received',
  cease_desist_received: 'Cease & Desist Received',
  mini_miranda_delivered: 'Mini-Miranda Delivered',
  right_to_cure_sent: 'Right to Cure Sent',
  payment_plan_agreed: 'Payment Plan Agreed',
  other: 'Other',
};

// ─── Sub-Tab Types ────────────────────────────────────
type ComplianceTab = 'log' | 'score' | 'violations' | 'hours' | 'disclosures' | 'audit' | 'sol' | 'docs';

interface Props {
  debtId: string;
  onRefresh?: () => void;
}

// ─── Tab Button ───────────────────────────────────────
const TabBtn: React.FC<{ active: boolean; label: string; icon: React.ReactNode; onClick: () => void }> = ({ active, label, icon, onClick }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors ${
      active
        ? 'bg-bg-tertiary text-text-primary border-b-2 border-accent-blue'
        : 'text-text-muted hover:text-text-secondary'
    }`}
    style={{ borderRadius: '6px 6px 0 0' }}
  >
    {icon}
    {label}
  </button>
);

// ─── Feature 41: Compliance Score Card ────────────────
const ComplianceScoreCard: React.FC<{ debtId: string; events: any[] }> = ({ debtId, events }) => {
  const [score, setScore] = useState<number>(0);
  const [breakdown, setBreakdown] = useState<{ label: string; pass: boolean; weight: number }[]>([]);

  useEffect(() => {
    const compute = async () => {
      const checks: { label: string; pass: boolean; weight: number }[] = [];

      // Check 1: Validation notice sent within 5 days
      const hasValidation = events.some(e => e.event_type === 'validation_notice_sent');
      checks.push({ label: 'Validation notice sent', pass: hasValidation, weight: 20 });

      // Check 2: Mini-Miranda delivered
      const hasMiniMiranda = events.some(e => e.event_type === 'mini_miranda_delivered');
      checks.push({ label: 'Mini-Miranda warning given', pass: hasMiniMiranda, weight: 20 });

      // Check 3: No communications after cease & desist
      const hasCeaseDesist = events.some(e => e.event_type === 'cease_desist_received');
      let postCdClean = true;
      if (hasCeaseDesist) {
        try {
          const cdEvent = events.find(e => e.event_type === 'cease_desist_received');
          const postComms = await api.rawQuery(
            `SELECT COUNT(*) as cnt FROM debt_communications WHERE debt_id = ? AND created_at > ?`,
            [debtId, cdEvent?.event_date || '']
          );
          postCdClean = Array.isArray(postComms) && postComms.length > 0 ? (postComms[0].cnt || 0) === 0 : true;
        } catch (_) {}
      }
      checks.push({ label: 'No post-C&D communications', pass: !hasCeaseDesist || postCdClean, weight: 25 });

      // Check 4: Communications within allowed hours (8am-9pm)
      let hoursCompliant = true;
      try {
        const badHours = await api.rawQuery(
          `SELECT COUNT(*) as cnt FROM debt_communications WHERE debt_id = ? AND (CAST(strftime('%H', created_at) AS INTEGER) < 8 OR CAST(strftime('%H', created_at) AS INTEGER) >= 21)`,
          [debtId]
        );
        hoursCompliant = Array.isArray(badHours) && badHours.length > 0 ? (badHours[0].cnt || 0) === 0 : true;
      } catch (_) {}
      checks.push({ label: 'Communications within allowed hours', pass: hoursCompliant, weight: 20 });

      // Check 5: Statute of limitations tracked
      let solTracked = true;
      try {
        const debt = await api.rawQuery(
          `SELECT statute_of_limitations_date FROM debts WHERE id = ?`,
          [debtId]
        );
        solTracked = Array.isArray(debt) && debt.length > 0 && !!debt[0].statute_of_limitations_date;
      } catch (_) { solTracked = false; }
      checks.push({ label: 'Statute of limitations tracked', pass: solTracked, weight: 15 });

      setBreakdown(checks);
      const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
      const passedWeight = checks.filter(c => c.pass).reduce((s, c) => s + c.weight, 0);
      setScore(totalWeight > 0 ? Math.round((passedWeight / totalWeight) * 100) : 0);
    };
    compute();
  }, [debtId, events]);

  const scoreColor = score >= 80 ? 'text-accent-income' : score >= 50 ? 'text-yellow-500' : 'text-accent-expense';
  const scoreBarColor = score >= 80 ? 'bg-accent-income' : score >= 50 ? 'bg-yellow-500' : 'bg-accent-expense';

  return (
    <div className="block-card p-5 space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <ShieldCheck size={16} className="text-accent-blue" />
        <h4 className="text-sm font-semibold text-text-primary">Compliance Score</h4>
      </div>
      <div className="flex items-center gap-4">
        <div className={`text-4xl font-mono font-bold ${scoreColor}`}>{score}</div>
        <div className="flex-1">
          <div className="w-full h-3 bg-bg-tertiary" style={{ borderRadius: 6 }}>
            <div className={`h-full ${scoreBarColor}`} style={{ width: `${score}%`, borderRadius: 6, transition: 'width 0.5s ease' }} />
          </div>
          <div className="text-[10px] text-text-muted mt-1">
            {score >= 80 ? 'Excellent compliance' : score >= 50 ? 'Needs improvement' : 'Critical — action required'}
          </div>
        </div>
      </div>
      <div className="space-y-2">
        {breakdown.map((item) => (
          <div key={item.label} className="flex items-center gap-2 text-xs">
            {item.pass ? (
              <CheckCircle size={12} className="text-accent-income flex-shrink-0" />
            ) : (
              <XCircle size={12} className="text-accent-expense flex-shrink-0" />
            )}
            <span className={item.pass ? 'text-text-secondary' : 'text-accent-expense font-medium'}>{item.label}</span>
            <span className="text-text-muted ml-auto">({item.weight} pts)</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Feature 42: FDCPA Violation Tracker ──────────────
const ViolationTracker: React.FC<{ companyId: string }> = ({ companyId }) => {
  const [violations, setViolations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await api.rawQuery(
          `SELECT d.id, d.debtor_name, d.cease_desist_active,
            (SELECT COUNT(*) FROM debt_communications dc WHERE dc.debt_id = d.id AND d.cease_desist_active = 1 AND dc.created_at > COALESCE(d.interest_frozen_date, '2000-01-01')) as post_cd_contacts,
            d.statute_of_limitations_date,
            CASE WHEN d.statute_of_limitations_date IS NOT NULL AND julianday(d.statute_of_limitations_date) < julianday('now') THEN 1 ELSE 0 END as sol_expired
          FROM debts d WHERE d.company_id = ? AND d.status = 'active'`,
          [companyId]
        );
        const data = Array.isArray(res) ? res : [];
        // Only show rows that have potential violations
        setViolations(data.filter((r: any) => (r.post_cd_contacts || 0) > 0 || r.sol_expired === 1));
      } catch (_) { setViolations([]); }
      setLoading(false);
    };
    load();
  }, [companyId]);

  if (loading) return <div className="text-text-muted text-sm text-center py-8">Loading violations...</div>;

  return (
    <div className="block-card p-5 space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle size={16} className="text-accent-expense" />
        <h4 className="text-sm font-semibold text-text-primary">FDCPA Violation Tracker</h4>
      </div>
      {violations.length === 0 ? (
        <div className="text-xs text-accent-income flex items-center gap-2 p-3 bg-accent-income/10 border border-accent-income/20" style={{ borderRadius: 6 }}>
          <CheckCircle size={14} />
          No potential violations detected. All active debts appear compliant.
        </div>
      ) : (
        <div>
          <div className="text-xs text-accent-expense mb-2 flex items-center gap-1">
            <AlertTriangle size={12} />
            {violations.length} potential violation{violations.length !== 1 ? 's' : ''} detected
          </div>
          <table className="block-table">
            <thead>
              <tr>
                <th>Debtor</th>
                <th className="text-center">C&D Active</th>
                <th className="text-center">Post-C&D Contacts</th>
                <th className="text-center">SOL Expired</th>
              </tr>
            </thead>
            <tbody>
              {violations.map((v: any) => (
                <tr key={v.id}>
                  <td className="text-text-primary font-medium text-sm">{v.debtor_name}</td>
                  <td className="text-center">
                    {v.cease_desist_active ? (
                      <span className="text-accent-expense font-semibold text-xs">YES</span>
                    ) : (
                      <span className="text-text-muted text-xs">No</span>
                    )}
                  </td>
                  <td className="text-center">
                    <span className={`font-mono text-xs ${(v.post_cd_contacts || 0) > 0 ? 'text-accent-expense font-bold' : 'text-text-muted'}`}>
                      {v.post_cd_contacts || 0}
                    </span>
                  </td>
                  <td className="text-center">
                    {v.sol_expired === 1 ? (
                      <span className="text-accent-expense font-semibold text-xs">EXPIRED</span>
                    ) : (
                      <span className="text-text-muted text-xs">OK</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ─── Feature 43: Communication Hours Tracker ──────────
const CommunicationHours: React.FC<{ debtId: string }> = ({ debtId }) => {
  const [hourData, setHourData] = useState<{ hour: number; count: number }[]>([]);
  const [outOfHours, setOutOfHours] = useState(0);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.rawQuery(
          `SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count FROM debt_communications WHERE debt_id = ? GROUP BY hour ORDER BY hour`,
          [debtId]
        );
        const data = Array.isArray(res) ? res : [];
        setHourData(data);
        setOutOfHours(data.filter((h: any) => h.hour < 8 || h.hour >= 21).reduce((s: number, h: any) => s + (h.count || 0), 0));
      } catch (_) { setHourData([]); }
    };
    load();
  }, [debtId]);

  // Build full 24-hour grid
  const hours = Array.from({ length: 24 }, (_, i) => {
    const found = hourData.find((h: any) => h.hour === i);
    return { hour: i, count: found?.count || 0, allowed: i >= 8 && i < 21 };
  });
  const maxCount = Math.max(...hours.map(h => h.count), 1);

  return (
    <div className="block-card p-5 space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <Clock size={16} className="text-accent-blue" />
        <h4 className="text-sm font-semibold text-text-primary">Communication Hours (FDCPA: 8am-9pm)</h4>
        {outOfHours > 0 && (
          <span className="text-[10px] font-semibold text-accent-expense bg-accent-expense/10 px-2 py-0.5 ml-auto" style={{ borderRadius: 6 }}>
            {outOfHours} outside allowed hours
          </span>
        )}
      </div>
      <div className="flex items-end gap-0.5" style={{ height: 80 }}>
        {hours.map((h) => (
          <div key={h.hour} className="flex flex-col items-center flex-1" style={{ minWidth: 0 }}>
            <div
              style={{
                height: `${Math.max((h.count / maxCount) * 60, h.count > 0 ? 4 : 0)}px`,
                width: '100%',
                background: !h.allowed && h.count > 0 ? '#ef4444' : h.allowed ? '#22c55e' : '#1a1a1a',
                borderRadius: '3px 3px 0 0',
                transition: 'height 0.3s ease',
                opacity: h.count === 0 ? 0.3 : 1,
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[9px] text-text-muted">
        <span>12am</span>
        <span>6am</span>
        <span className="text-accent-income font-semibold">8am</span>
        <span>12pm</span>
        <span>6pm</span>
        <span className="text-accent-income font-semibold">9pm</span>
        <span>12am</span>
      </div>
      <div className="flex gap-4 text-[10px] text-text-muted">
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-accent-income inline-block" style={{ borderRadius: 2 }} /> Allowed (8am-9pm)</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-accent-expense inline-block" style={{ borderRadius: 2 }} /> Prohibited</span>
      </div>
    </div>
  );
};

// ─── Feature 44: Required Disclosures Checklist ───────
const DisclosuresChecklist: React.FC<{ debtId: string; events: any[] }> = ({ debtId, events }) => {
  const disclosures = [
    { key: 'mini_miranda_delivered', label: 'Mini-Miranda Warning', desc: 'Collector identified as debt collector in initial communication', required: true },
    { key: 'validation_notice_sent', label: 'Debt Validation Notice', desc: 'Written notice sent within 5 days of initial communication', required: true },
    { key: 'dispute_received', label: 'Written Verification (if disputed)', desc: 'If debtor disputed, verification was provided before continuing', required: false },
    { key: 'right_to_cure_sent', label: 'Right to Cure Notice', desc: 'Notice sent per state requirements before legal action', required: false },
  ];

  return (
    <div className="block-card p-5 space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <FileCheck size={16} className="text-accent-blue" />
        <h4 className="text-sm font-semibold text-text-primary">Required Disclosures Checklist</h4>
      </div>
      <div className="space-y-2">
        {disclosures.map((d) => {
          const done = events.some(e => e.event_type === d.key);
          return (
            <div key={d.key} className="flex items-start gap-3 p-3 bg-bg-tertiary" style={{ borderRadius: 6 }}>
              <div className="mt-0.5 flex-shrink-0">
                {done ? (
                  <CheckCircle size={16} className="text-accent-income" />
                ) : (
                  <XCircle size={16} className={d.required ? 'text-accent-expense' : 'text-text-muted'} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold ${done ? 'text-text-primary' : d.required ? 'text-accent-expense' : 'text-text-secondary'}`}>
                    {d.label}
                  </span>
                  {d.required && !done && (
                    <span className="text-[9px] font-bold text-accent-expense bg-accent-expense/10 px-1.5 py-0.5" style={{ borderRadius: 4 }}>REQUIRED</span>
                  )}
                </div>
                <div className="text-[11px] text-text-muted mt-0.5">{d.desc}</div>
                {done && (
                  <div className="text-[10px] text-accent-income mt-0.5">
                    Completed: {events.find(e => e.event_type === d.key)?.event_date || 'date unknown'}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Feature 45: Audit Trail ──────────────────────────
const ComplianceAuditTrail: React.FC<{ debtId: string }> = ({ debtId }) => {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        // Combine compliance log + audit log
        const [compLog, auditLog] = await Promise.all([
          api.rawQuery(
            `SELECT id, event_type as action, event_date as performed_at, notes, 'compliance' as source FROM debt_compliance_log WHERE debt_id = ? ORDER BY event_date DESC`,
            [debtId]
          ).catch(() => []),
          api.rawQuery(
            `SELECT id, action, performed_at, COALESCE(field_name, '') as field_name, COALESCE(old_value, '') as old_value, COALESCE(new_value, '') as new_value, COALESCE(performed_by, 'system') as performed_by, 'audit' as source FROM debt_audit_log WHERE debt_id = ? ORDER BY performed_at DESC`,
            [debtId]
          ).catch(() => []),
        ]);
        const combined = [
          ...(Array.isArray(compLog) ? compLog : []).map((e: any) => ({ ...e, timestamp: e.performed_at })),
          ...(Array.isArray(auditLog) ? auditLog : []).map((e: any) => ({ ...e, timestamp: e.performed_at })),
        ].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
        setEntries(combined);
      } catch (_) { setEntries([]); }
      setLoading(false);
    };
    load();
  }, [debtId]);

  if (loading) return <div className="text-text-muted text-sm text-center py-8">Loading audit trail...</div>;

  return (
    <div className="block-card p-5 space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <Activity size={16} className="text-accent-blue" />
        <h4 className="text-sm font-semibold text-text-primary">Compliance Audit Trail</h4>
        <span className="text-xs text-text-muted ml-auto">{entries.length} entries</span>
      </div>
      {entries.length === 0 ? (
        <div className="text-text-muted text-xs text-center py-4">No audit entries found.</div>
      ) : (
        <div className="space-y-1 max-h-[50vh] overflow-y-auto">
          {entries.map((entry: any, i: number) => (
            <div
              key={entry.id || i}
              className={`flex items-start gap-3 px-3 py-2 text-xs border-l-2 ${entry.source === 'compliance' ? 'border-accent-blue' : 'border-border-primary'} hover:bg-bg-hover transition-colors`}
              style={{ borderRadius: '0 6px 6px 0' }}
            >
              <span className="text-text-muted font-mono whitespace-nowrap flex-shrink-0">{entry.timestamp || '-'}</span>
              <div className="flex-1 min-w-0">
                <span className="text-text-primary font-semibold">
                  {EVENT_LABELS[entry.action] || entry.action}
                </span>
                {entry.field_name && <span className="text-text-muted ml-1">({entry.field_name})</span>}
                {entry.old_value && entry.new_value && <span className="text-text-muted ml-1">{entry.old_value} → {entry.new_value}</span>}
                {entry.notes && <span className="text-text-muted ml-1">— {entry.notes}</span>}
              </div>
              <span className="text-[10px] text-text-muted capitalize flex-shrink-0">
                {entry.source === 'compliance' ? 'Compliance' : entry.performed_by || 'system'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Feature 46: Statute of Limitations Dashboard ─────
const SOLDashboard: React.FC<{ companyId: string }> = ({ companyId }) => {
  const [debts, setDebts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await api.rawQuery(
          `SELECT id, debtor_name, original_amount, balance_due, statute_of_limitations_date,
            CASE WHEN statute_of_limitations_date IS NOT NULL THEN CAST(julianday(statute_of_limitations_date) - julianday('now') AS INTEGER) ELSE NULL END as days_remaining
          FROM debts WHERE company_id = ? AND status IN ('active','in_collection','legal') AND statute_of_limitations_date IS NOT NULL
          ORDER BY days_remaining ASC`,
          [companyId]
        );
        setDebts(Array.isArray(res) ? res : []);
      } catch (_) { setDebts([]); }
      setLoading(false);
    };
    load();
  }, [companyId]);

  if (loading) return <div className="text-text-muted text-sm text-center py-8">Loading SOL data...</div>;

  const solColor = (days: number | null) => {
    if (days === null) return 'text-text-muted';
    if (days <= 0) return 'text-accent-expense';
    if (days <= 30) return 'text-accent-expense';
    if (days <= 90) return 'text-orange-500';
    if (days <= 180) return 'text-yellow-500';
    return 'text-accent-income';
  };

  const solBg = (days: number | null) => {
    if (days === null) return 'bg-bg-tertiary';
    if (days <= 0) return 'bg-accent-expense/10 border border-accent-expense/30';
    if (days <= 30) return 'bg-accent-expense/10 border border-accent-expense/20';
    if (days <= 90) return 'bg-orange-500/10 border border-orange-500/20';
    return 'bg-bg-tertiary';
  };

  return (
    <div className="block-card p-5 space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <Clock size={16} className="text-accent-blue" />
        <h4 className="text-sm font-semibold text-text-primary">Statute of Limitations Dashboard</h4>
        <span className="text-xs text-text-muted ml-auto">{debts.length} debts tracked</span>
      </div>
      {debts.length === 0 ? (
        <div className="text-text-muted text-xs text-center py-4">No debts with SOL dates tracked.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {debts.map((d: any) => (
            <div key={d.id} className={`p-3 ${solBg(d.days_remaining)}`} style={{ borderRadius: 6 }}>
              <div className="text-xs font-semibold text-text-primary truncate">{d.debtor_name}</div>
              <div className="text-[10px] text-text-muted mt-0.5">{formatCurrency(d.balance_due)}</div>
              <div className={`text-sm font-mono font-bold mt-1 ${solColor(d.days_remaining)}`}>
                {d.days_remaining !== null ? (
                  d.days_remaining <= 0 ? 'EXPIRED' : `${d.days_remaining} days`
                ) : 'Not set'}
              </div>
              <div className="text-[10px] text-text-muted">
                Expires: {d.statute_of_limitations_date || 'N/A'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Feature 47: Document Verification ────────────────
const DocumentVerification: React.FC<{ companyId: string }> = ({ companyId }) => {
  const [debts, setDebts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await api.rawQuery(
          `SELECT d.id, d.debtor_name, d.original_amount,
            (SELECT COUNT(*) FROM debt_evidence de WHERE de.debt_id = d.id) as evidence_count,
            (SELECT COUNT(*) FROM debt_evidence de WHERE de.debt_id = d.id AND de.evidence_type = 'original_contract') as has_contract,
            (SELECT COUNT(*) FROM debt_evidence de WHERE de.debt_id = d.id AND de.evidence_type = 'itemized_statement') as has_statement,
            (SELECT COUNT(*) FROM debt_evidence de WHERE de.debt_id = d.id AND de.evidence_type = 'assignment') as has_assignment
          FROM debts d WHERE d.company_id = ? AND d.status IN ('active','in_collection','legal')
          ORDER BY d.debtor_name`,
          [companyId]
        );
        setDebts(Array.isArray(res) ? res : []);
      } catch (_) { setDebts([]); }
      setLoading(false);
    };
    load();
  }, [companyId]);

  if (loading) return <div className="text-text-muted text-sm text-center py-8">Loading document status...</div>;

  const DocIcon: React.FC<{ has: boolean }> = ({ has }) => has ? (
    <CheckCircle size={12} className="text-accent-income" />
  ) : (
    <XCircle size={12} className="text-accent-expense" />
  );

  return (
    <div className="block-card p-5 space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <FileCheck size={16} className="text-accent-blue" />
        <h4 className="text-sm font-semibold text-text-primary">Document Verification</h4>
      </div>
      {debts.length === 0 ? (
        <div className="text-text-muted text-xs text-center py-4">No active debts to verify.</div>
      ) : (
        <table className="block-table">
          <thead>
            <tr>
              <th>Debtor</th>
              <th className="text-right">Amount</th>
              <th className="text-center">Contract</th>
              <th className="text-center">Statement</th>
              <th className="text-center">Assignment</th>
              <th className="text-center">Total Docs</th>
            </tr>
          </thead>
          <tbody>
            {debts.map((d: any) => (
              <tr key={d.id}>
                <td className="text-text-primary font-medium text-sm">{d.debtor_name}</td>
                <td className="text-right font-mono text-sm">{formatCurrency(d.original_amount)}</td>
                <td className="text-center"><DocIcon has={(d.has_contract || 0) > 0} /></td>
                <td className="text-center"><DocIcon has={(d.has_statement || 0) > 0} /></td>
                <td className="text-center"><DocIcon has={(d.has_assignment || 0) > 0} /></td>
                <td className="text-center font-mono text-xs text-text-secondary">{d.evidence_count || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

// ─── Main Component ───────────────────────────────────
const ComplianceLog: React.FC<Props> = ({ debtId, onRefresh }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const companyId = activeCompany?.id || '';

  const [activeTab, setActiveTab] = useState<ComplianceTab>('log');
  const [events, setEvents] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const defaultForm = { event_type: 'validation_notice_sent', event_date: '', notes: '' };
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [opSuccess, setOpSuccess] = useState('');
  const [opError, setOpError] = useState('');

  const load = async () => {
    try {
      const data = await api.listComplianceLog(debtId);
      setEvents(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
  };

  useEffect(() => { load(); }, [debtId]);

  const handleSave = async () => {
    if (saving) return;
    if (!form.event_date) return;
    setSaving(true);
    try {
      if (editingId) {
        await api.update('debt_compliance_log', editingId, form);
      } else {
        await api.saveComplianceEvent({ debt_id: debtId, ...form });
      }
      setShowForm(false);
      setEditingId(null);
      setForm(defaultForm);
      await load();
      onRefresh?.();
      setOpSuccess(editingId ? 'Event updated' : 'Event logged'); setTimeout(() => setOpSuccess(''), 3000);
    } catch (err: any) {
      console.error('Failed to save compliance event:', err);
      setOpError('Failed to save: ' + (err?.message || 'Unknown error')); setTimeout(() => setOpError(''), 5000);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (ev: any) => {
    setEditingId(ev.id);
    setForm({
      event_type: ev.event_type,
      event_date: ev.event_date || '',
      notes: ev.notes || '',
    });
    setShowForm(true);
    setActiveTab('log');
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this compliance event?')) return;
    try {
      await api.remove('debt_compliance_log', id);
      await load();
      onRefresh?.();
      setOpSuccess('Event deleted'); setTimeout(() => setOpSuccess(''), 3000);
    } catch (err: any) {
      console.error('Failed to delete compliance event:', err);
      setOpError('Failed to delete: ' + (err?.message || 'Unknown error')); setTimeout(() => setOpError(''), 5000);
    }
  };

  const hasCeaseDesist = events.some(e => e.event_type === 'cease_desist_received');

  // Feature 48: Print Compliance Report
  const handlePrintReport = () => {
    const sections: string[] = [];
    sections.push('<h2>FDCPA Compliance Audit Report</h2>');
    sections.push(`<p style="color:#666;">Generated: ${new Date().toLocaleString()}</p>`);
    sections.push(`<p>Debt ID: ${debtId}</p>`);

    if (hasCeaseDesist) {
      sections.push('<div style="background:#fee;border:1px solid #f00;padding:8px;border-radius:6px;margin:12px 0;"><strong style="color:#f00;">WARNING: Cease & Desist received — communications restricted</strong></div>');
    }

    sections.push('<h3>Compliance Events</h3>');
    if (events.length === 0) {
      sections.push('<p style="color:#888;">No compliance events logged.</p>');
    } else {
      sections.push('<table style="width:100%;border-collapse:collapse;font-size:11px;"><thead><tr><th style="text-align:left;padding:4px 8px;border-bottom:2px solid #333;">Date</th><th style="text-align:left;padding:4px 8px;border-bottom:2px solid #333;">Event</th><th style="text-align:left;padding:4px 8px;border-bottom:2px solid #333;">Notes</th></tr></thead><tbody>');
      events.forEach((ev, i) => {
        sections.push(`<tr style="background:${i % 2 ? '#f9f9f9' : '#fff'}"><td style="padding:4px 8px;border-bottom:1px solid #eee;">${ev.event_date || '-'}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;">${EVENT_LABELS[ev.event_type] || ev.event_type}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;">${ev.notes || '-'}</td></tr>`);
      });
      sections.push('</tbody></table>');
    }

    sections.push('<h3>Required Disclosures Status</h3>');
    const disclosureChecks = [
      { key: 'mini_miranda_delivered', label: 'Mini-Miranda Warning' },
      { key: 'validation_notice_sent', label: 'Debt Validation Notice' },
      { key: 'dispute_received', label: 'Written Verification (if disputed)' },
      { key: 'right_to_cure_sent', label: 'Right to Cure Notice' },
    ];
    disclosureChecks.forEach(d => {
      const done = events.some(e => e.event_type === d.key);
      sections.push(`<p style="margin:4px 0;">${done ? '&#9989;' : '&#10060;'} ${d.label} — ${done ? 'Completed' : 'Pending'}</p>`);
    });

    const html = `<!DOCTYPE html><html><head><title>Compliance Report</title><style>body{font-family:-apple-system,sans-serif;padding:32px;color:#111;}h2{margin-bottom:4px;}h3{margin-top:20px;margin-bottom:8px;border-bottom:1px solid #ddd;padding-bottom:4px;}</style></head><body>${sections.join('\n')}<div style="margin-top:32px;font-size:10px;color:#999;border-top:1px solid #eee;padding-top:8px;">FDCPA Compliance Report — Confidential</div></body></html>`;
    api.printPreview(html, 'Compliance Audit Report');
  };

  return (
    <div className="block-card p-5 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck size={15} className="text-accent-blue" />
          <h4 className="text-sm font-semibold text-text-primary">FDCPA Compliance</h4>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="block-btn flex items-center gap-1.5 text-xs py-1 px-3"
            onClick={handlePrintReport}
          >
            <Printer size={12} />
            Print Report
          </button>
          <button
            className="block-btn flex items-center gap-1.5 text-xs py-1 px-3"
            onClick={() => { setActiveTab('log'); setShowForm(s => !s); }}
          >
            <Plus size={12} />
            Log Event
          </button>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex border-b border-border-primary mb-4 overflow-x-auto">
        <TabBtn active={activeTab === 'log'} label="Event Log" icon={<ShieldCheck size={12} />} onClick={() => setActiveTab('log')} />
        <TabBtn active={activeTab === 'score'} label="Score" icon={<Activity size={12} />} onClick={() => setActiveTab('score')} />
        <TabBtn active={activeTab === 'violations'} label="Violations" icon={<AlertTriangle size={12} />} onClick={() => setActiveTab('violations')} />
        <TabBtn active={activeTab === 'hours'} label="Hours" icon={<Clock size={12} />} onClick={() => setActiveTab('hours')} />
        <TabBtn active={activeTab === 'disclosures'} label="Disclosures" icon={<FileCheck size={12} />} onClick={() => setActiveTab('disclosures')} />
        <TabBtn active={activeTab === 'audit'} label="Audit Trail" icon={<Activity size={12} />} onClick={() => setActiveTab('audit')} />
        <TabBtn active={activeTab === 'sol'} label="SOL" icon={<Clock size={12} />} onClick={() => setActiveTab('sol')} />
        <TabBtn active={activeTab === 'docs'} label="Documents" icon={<FileCheck size={12} />} onClick={() => setActiveTab('docs')} />
      </div>

      {opSuccess && <div className="text-xs text-accent-income bg-accent-income/10 px-3 py-2 border border-accent-income/20 mb-3" style={{ borderRadius: '6px' }}>{opSuccess}</div>}
      {opError && <div className="text-xs text-accent-expense bg-accent-expense/10 px-3 py-2 border border-accent-expense/20 mb-3" style={{ borderRadius: '6px' }}>{opError}</div>}

      {hasCeaseDesist && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid #ef4444',
            borderRadius: 6,
            marginBottom: 12,
          }}
        >
          <AlertTriangle size={14} color="#ef4444" />
          <span style={{ fontSize: 12, color: '#ef4444', fontWeight: 600 }}>
            Cease &amp; Desist received — communications restricted
          </span>
        </div>
      )}

      {/* ── Event Log Tab ── */}
      {activeTab === 'log' && (
        <>
          {showForm && (
            <div className="grid grid-cols-2 gap-3 mb-4 p-4 bg-bg-tertiary" style={{ borderRadius: 6 }}>
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
                  Event Type
                </label>
                <select
                  className="block-select"
                  value={form.event_type}
                  onChange={e => setForm(p => ({ ...p, event_type: e.target.value }))}
                >
                  {Object.entries(EVENT_LABELS)
                    .sort(([, a], [, b]) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base' }))
                    .map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
                  Event Date
                </label>
                <input
                  type="date"
                  className="block-input"
                  value={form.event_date}
                  onChange={e => setForm(p => ({ ...p, event_date: e.target.value }))}
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
                  Notes
                </label>
                <input
                  className="block-input"
                  placeholder="Additional details..."
                  value={form.notes}
                  onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                />
              </div>
              <div className="col-span-2 flex justify-end gap-2">
                <button className="block-btn text-xs py-1 px-3" onClick={() => setShowForm(false)}>
                  Cancel
                </button>
                <button
                  className="block-btn-primary text-xs py-1 px-3"
                  disabled={saving}
                  onClick={handleSave}
                >
                  {saving ? 'Saving...' : editingId ? 'Update Event' : 'Log Event'}
                </button>
              </div>
            </div>
          )}

          {events.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
              No compliance events logged.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {events.map(ev => (
                <div
                  key={ev.id}
                  style={{
                    display: 'flex',
                    gap: 10,
                    padding: '8px 10px',
                    background: 'var(--color-bg-tertiary)',
                    borderRadius: 6,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--color-text-muted)',
                      whiteSpace: 'nowrap',
                      minWidth: 80,
                    }}
                  >
                    {ev.event_date}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                      {EVENT_LABELS[ev.event_type] || ev.event_type}
                    </div>
                    {ev.notes && (
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                        {ev.notes}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                    <button
                      className="block-btn text-xs px-1.5 py-0.5"
                      onClick={() => handleEdit(ev)}
                      title="Edit event"
                    >
                      <Pencil size={10} />
                    </button>
                    <button
                      className="block-btn text-xs px-1.5 py-0.5 text-accent-expense hover:bg-accent-expense/10 transition-colors"
                      onClick={() => handleDelete(ev.id)}
                      title="Delete event"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Feature 41: Score Tab ── */}
      {activeTab === 'score' && (
        <ComplianceScoreCard debtId={debtId} events={events} />
      )}

      {/* ── Feature 42: Violations Tab ── */}
      {activeTab === 'violations' && companyId && (
        <ViolationTracker companyId={companyId} />
      )}

      {/* ── Feature 43: Hours Tab ── */}
      {activeTab === 'hours' && (
        <CommunicationHours debtId={debtId} />
      )}

      {/* ── Feature 44: Disclosures Tab ── */}
      {activeTab === 'disclosures' && (
        <DisclosuresChecklist debtId={debtId} events={events} />
      )}

      {/* ── Feature 45: Audit Trail Tab ── */}
      {activeTab === 'audit' && (
        <ComplianceAuditTrail debtId={debtId} />
      )}

      {/* ── Feature 46: SOL Dashboard Tab ── */}
      {activeTab === 'sol' && companyId && (
        <SOLDashboard companyId={companyId} />
      )}

      {/* ── Feature 47: Documents Tab ── */}
      {activeTab === 'docs' && companyId && (
        <DocumentVerification companyId={companyId} />
      )}
    </div>
  );
};

export default ComplianceLog;
