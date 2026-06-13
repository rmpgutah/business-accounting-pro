// src/renderer/modules/vendors-ap/Overview.tsx
import React, { useEffect, useState } from 'react';
import { Building2, AlertTriangle, Layers, Wallet } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import { Section, Empty, Th, Td, StatCard, MiniBar, TOK } from './shared/ui';

const Overview: React.FC<{ onViewVendor?: (id: string) => void }> = ({ onViewVendor }) => {
  const [counts, setCounts] = useState<any>(null);
  const [portfolio, setPortfolio] = useState<any>(null);
  const [concentration, setConcentration] = useState<any>(null);
  const [ranking, setRanking] = useState<any[]>([]);
  const [byType, setByType] = useState<any[]>([]);
  const [byLocation, setByLocation] = useState<any[]>([]);
  const [apAging, setApAging] = useState<any[]>([]);
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    const arr = (s: (v: any[]) => void) => (r: any) => { if (!cancelled && Array.isArray(r)) s(r); };
    const obj = (s: (v: any) => void) => (r: any) => { if (!cancelled && r && !r.error) s(r); };
    const quiet = () => {};
    api.vnCount().then(obj(setCounts)).catch(quiet);
    api.vnPortfolioSummary().then(obj(setPortfolio)).catch(quiet);
    api.vnConcentration().then(obj(setConcentration)).catch(quiet);
    api.vnRanking(12).then(arr(setRanking)).catch(quiet);
    api.vnByType().then(arr(setByType)).catch(quiet);
    api.vnByLocation().then(arr(setByLocation)).catch(quiet);
    api.featApAgingChart().then(arr(setApAging)).catch(quiet);
    api.vnHealthCheck().then(obj(setHealth)).catch(quiet);
    return () => { cancelled = true; };
  }, []);

  const open = (id: string) => { if (id && onViewVendor) onViewVendor(id); };
  const maxType = Math.max(1, ...byType.map((t: any) => t.count || 0));
  const maxLoc = Math.max(1, ...byLocation.map((t: any) => t.count || 0));
  const apTotal = apAging.reduce((s, b: any) => s + (b.total || b.amount || 0), 0);

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Vendors" value={counts?.total ?? '—'} sub={counts ? `${counts.approved} approved · ${counts.pending} pending` : undefined} />
        <StatCard label="Total Spend" value={portfolio ? formatCurrency(portfolio.totalSpend) : '—'} sub={portfolio ? `avg ${formatCurrency(portfolio.avgSpendPerVendor)}/vendor` : undefined} />
        <StatCard label="Top-3 Concentration" value={concentration ? `${concentration.top3Concentration}%` : '—'}
          sub="share of spend in top 3" color={concentration && concentration.top3Concentration > 60 ? TOK.warning : undefined} />
        <StatCard label="Open Compliance Issues" value={health?.totalIssues ?? '—'}
          sub={health?.healthy ? 'all clear' : 'needs attention'} color={health && health.totalIssues > 0 ? TOK.expense : TOK.income} />
      </div>

      {/* Top vendors */}
      <Section title="Top Vendors by Spend" icon={<Building2 size={13} style={{ color: TOK.blue }} />} count={ranking.length}>
        {ranking.length === 0 ? <Empty msg="No vendor spend recorded yet." /> : (
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: `1px solid ${TOK.border}` }}><Th>Vendor</Th><Th right>Txns</Th><Th right>Total Spend</Th><Th right>Last Txn</Th><Th /></tr></thead>
              <tbody>
                {ranking.map((v: any) => (
                  <tr key={v.id} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td>{v.name}</Td>
                    <Td right mono>{v.txn_count}</Td>
                    <Td right mono>{formatCurrency(v.total_spend)}</Td>
                    <Td right mono color={TOK.muted}>{v.last_txn || '—'}</Td>
                    <Td right><button className="block-btn text-[10px]" onClick={() => open(v.id)}>View</button></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Distributions + AP aging */}
      <div className="grid md:grid-cols-3 gap-4">
        <Section title="By Vendor Type" icon={<Layers size={13} style={{ color: TOK.blue }} />}>
          {byType.length === 0 ? <Empty msg="No data." /> : (
            <div className="p-3 space-y-1.5">
              {byType.map((t: any) => (
                <MiniBar key={t.type} label={String(t.type).replace(/_/g, ' ')} value={t.count} max={maxType} valueLabel={`${t.count}`} />
              ))}
            </div>
          )}
        </Section>
        <Section title="By Location" icon={<Layers size={13} style={{ color: TOK.blue }} />}>
          {byLocation.length === 0 ? <Empty msg="No data." /> : (
            <div className="p-3 space-y-1.5">
              {byLocation.map((t: any) => (
                <MiniBar key={t.location} label={String(t.location).replace(/_/g, ' ')} value={t.count} max={maxLoc} valueLabel={`${t.count}`} />
              ))}
            </div>
          )}
        </Section>
        <Section title="AP Aging" icon={<Wallet size={13} style={{ color: TOK.warning }} />} right={<span className="text-[10px] text-text-muted font-mono">{formatCurrency(apTotal)}</span>}>
          {apAging.length === 0 ? <Empty msg="No outstanding payables." /> : (
            <div className="p-3 space-y-1.5">
              {apAging.map((b: any, i: number) => {
                const amt = b.total ?? b.amount ?? 0;
                const label = b.bucket ?? b.label ?? b.range ?? `bucket ${i + 1}`;
                const late = String(label).includes('90') || String(label).includes('61');
                return <MiniBar key={i} label={String(label)} value={amt} max={Math.max(1, ...apAging.map((x: any) => x.total ?? x.amount ?? 0))} valueLabel={formatCurrency(amt)} barColor={late ? TOK.expense : TOK.warning} />;
              })}
            </div>
          )}
        </Section>
      </div>

      {/* Health issues */}
      <Section title="Compliance Health" icon={<AlertTriangle size={13} style={{ color: TOK.warning }} />} count={health?.issues?.length}>
        {!health || !health.issues || health.issues.length === 0 ? <Empty msg="No open compliance issues — vendor records are audit-ready." /> : (
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: `1px solid ${TOK.border}` }}><Th>Vendor</Th><Th>Issue</Th><Th right>Severity</Th></tr></thead>
              <tbody>
                {health.issues.map((iss: any, i: number) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td>{iss.vendor || iss.name || '—'}</Td>
                    <Td>{iss.issue}</Td>
                    <Td right color={iss.severity === 'high' ? TOK.expense : TOK.warning}>{iss.severity}</Td>
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

export default Overview;
