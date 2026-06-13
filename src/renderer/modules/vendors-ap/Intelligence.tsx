// src/renderer/modules/vendors-ap/Intelligence.tsx
//
// Intelligence tab — payment-risk flags, duplicate vendors, spend anomalies, risk leaderboard.
// Pattern: per-slice useState + one useEffect with cancelled guard, no Promise.all.

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Copy, TrendingUp, ShieldAlert } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import { Section, Empty, Th, Td, StatCard, TOK, gradeColor } from './shared/ui';

const Intelligence: React.FC<{ onViewVendor?: (id: string) => void }> = ({ onViewVendor }) => {
  const [achFlags, setAchFlags] = useState<any[]>([]);
  const [dupes, setDupes] = useState<any[]>([]);
  const [anomalies, setAnomalies] = useState<any[]>([]);
  const [riskScores, setRiskScores] = useState<any[]>([]);
  const [concentration, setConcentration] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    const arr = (s: (v: any[]) => void) => (r: any) => {
      if (!cancelled && Array.isArray(r)) s(r);
    };
    const obj = (s: (v: any) => void) => (r: any) => {
      if (!cancelled && r && !r.error) s(r);
    };
    const quiet = () => {};

    api.vnAchRiskFlags().then(arr(setAchFlags)).catch(quiet);
    api.vnDuplicateVendors().then(arr(setDupes)).catch(quiet);
    api.exVendorAnomalies(2).then(arr(setAnomalies)).catch(quiet);
    api.vnRiskScore().then(arr(setRiskScores)).catch(quiet);
    api.vnConcentration().then(obj(setConcentration)).catch(quiet);

    return () => { cancelled = true; };
  }, []);

  const highRiskCount = riskScores.filter((r: any) => r.grade === 'D' || r.grade === 'F').length;
  const top3 = concentration?.top3Concentration ?? null;

  const open = (id: string) => { if (id && onViewVendor) onViewVendor(id); };

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="High-Risk Vendors"
          value={highRiskCount}
          sub="grade D or F"
          color={highRiskCount > 0 ? TOK.expense : TOK.income}
        />
        <StatCard
          label="ACH Risk Flags"
          value={achFlags.length}
          sub="bank change near due date"
          color={achFlags.length > 0 ? TOK.expense : TOK.income}
        />
        <StatCard
          label="Duplicate Pairs"
          value={dupes.length}
          sub="name / tax ID / email / ACH"
          color={dupes.length > 0 ? TOK.warning : TOK.income}
        />
        <StatCard
          label="Top-3 Concentration"
          value={top3 !== null ? `${top3}%` : '—'}
          sub="share of spend in top 3"
          color={top3 !== null && top3 > 60 ? TOK.warning : undefined}
        />
      </div>

      {/* Payment-Risk Flags */}
      <Section
        title="Payment-Risk Flags"
        icon={<AlertTriangle size={13} style={{ color: TOK.expense }} />}
        count={achFlags.length}
      >
        {achFlags.length === 0 ? (
          <Empty msg="No ACH risk flags detected." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${TOK.border}` }}>
                  <Th>Vendor</Th>
                  <Th>ACH Change Date</Th>
                  <Th>Bill #</Th>
                  <Th>Due Date</Th>
                  <Th right>Balance</Th>
                  <Th>Reason</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {achFlags.map((f: any, i: number) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td>{f.vendor_name}</Td>
                    <Td mono color={TOK.expense}>{f.ach_submitted_at ? String(f.ach_submitted_at).slice(0, 10) : '—'}</Td>
                    <Td mono>{f.bill_number || f.bill_id?.slice(0, 8) || '—'}</Td>
                    <Td mono>{f.due_date || '—'}</Td>
                    <Td right mono color={TOK.expense}>{formatCurrency(f.balance ?? 0)}</Td>
                    <Td>
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5"
                        style={{ borderRadius: 4, background: 'color-mix(in srgb, var(--color-accent-expense) 14%, transparent)', color: TOK.expense }}
                      >
                        {f.reason}
                      </span>
                    </Td>
                    <Td right>
                      <button className="block-btn text-[10px]" onClick={() => open(f.vendor_id)}>
                        Review
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Duplicate Vendors */}
      <Section
        title="Duplicate Vendors"
        icon={<Copy size={13} style={{ color: TOK.warning }} />}
        count={dupes.length}
      >
        {dupes.length === 0 ? (
          <Empty msg="No duplicate vendors detected." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${TOK.border}` }}>
                  <Th>Vendor A</Th>
                  <Th>Vendor B</Th>
                  <Th>Match Reason</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {dupes.map((d: any, i: number) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td>{d.name_a}</Td>
                    <Td>{d.name_b}</Td>
                    <Td>
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5"
                        style={{ borderRadius: 4, background: 'color-mix(in srgb, var(--color-accent-warning) 14%, transparent)', color: TOK.warning }}
                      >
                        {d.match_reason}
                      </span>
                    </Td>
                    <Td right>
                      <div className="flex gap-1 justify-end">
                        <button className="block-btn text-[10px]" onClick={() => open(d.id_a)}>
                          Review A
                        </button>
                        <button className="block-btn text-[10px]" onClick={() => open(d.id_b)}>
                          Review B
                        </button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Spend Anomalies */}
      <Section
        title="Spend Anomalies"
        icon={<TrendingUp size={13} style={{ color: TOK.blue }} />}
        count={anomalies.length}
      >
        {anomalies.length === 0 ? (
          <Empty msg="No spend anomalies detected (z-score > 2)." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${TOK.border}` }}>
                  <Th>Vendor</Th>
                  <Th>Date</Th>
                  <Th right>Charged</Th>
                  <Th right>Typical Avg</Th>
                  <Th right>Z-Score</Th>
                </tr>
              </thead>
              <tbody>
                {anomalies.map((a: any) => (
                  <tr key={a.id} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td>{a.vendor_name || '—'}</Td>
                    <Td mono color={TOK.muted}>{a.date || '—'}</Td>
                    <Td right mono color={TOK.expense}>{formatCurrency(a.amount)}</Td>
                    <Td right mono>{formatCurrency(a.avg_amt)}</Td>
                    <Td right mono color={Math.abs(a.z_score) > 3 ? TOK.expense : TOK.warning}>
                      {typeof a.z_score === 'number' ? a.z_score.toFixed(1) : '—'}σ
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Risk Leaderboard */}
      <Section
        title="Risk Leaderboard"
        icon={<ShieldAlert size={13} style={{ color: TOK.expense }} />}
        count={riskScores.length}
      >
        {riskScores.length === 0 ? (
          <Empty msg="No vendor risk scores available." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${TOK.border}` }}>
                  <Th>Vendor</Th>
                  <Th>Grade</Th>
                  <Th right>Score</Th>
                  <Th>Top Factors</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {riskScores.map((r: any) => (
                  <tr key={r.vendorId} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td>{r.name}</Td>
                    <Td>
                      <span
                        className="text-[11px] font-bold px-1.5 py-0.5"
                        style={{ borderRadius: 4, color: gradeColor(r.grade), background: 'color-mix(in srgb, currentColor 12%, transparent)' }}
                      >
                        {r.grade}
                      </span>
                    </Td>
                    <Td right mono color={gradeColor(r.grade)}>
                      {typeof r.score === 'number' ? r.score : '—'}
                    </Td>
                    <Td color={TOK.muted}>
                      {Array.isArray(r.factors) && r.factors.length > 0
                        ? r.factors.slice(0, 2).join('; ')
                        : '—'}
                    </Td>
                    <Td right>
                      <button className="block-btn text-[10px]" onClick={() => open(r.vendorId)}>
                        View
                      </button>
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

export default Intelligence;
