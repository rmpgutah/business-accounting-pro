// src/renderer/modules/vendors-ap/ComplianceHub.tsx
import React, { useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, FileWarning, Gavel } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import { Section, Empty, Th, Td, StatCard, TOK } from './shared/ui';

const ComplianceHub: React.FC<{ onViewVendor?: (id: string) => void }> = ({ onViewVendor }) => {
  const [health, setHealth] = useState<any>(null);
  const [expIns, setExpIns] = useState<any[]>([]);
  const [expContracts, setExpContracts] = useState<any[]>([]);
  const [disputes, setDisputes] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    const arr = (s: (v: any[]) => void) => (r: any) => { if (!cancelled && Array.isArray(r)) s(r); };
    const obj = (s: (v: any) => void) => (r: any) => { if (!cancelled && r && !r.error) s(r); };
    api.vnHealthCheck().then(obj(setHealth)).catch(() => {});
    api.vnExpiredInsurance().then(arr(setExpIns)).catch(() => {});
    api.vnExpiredContracts().then(arr(setExpContracts)).catch(() => {});
    api.vnDisputes().then(arr(setDisputes)).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const open = (id: string) => { if (id && onViewVendor) onViewVendor(id); };
  const openDisputes = disputes.filter((d: any) => d.status === 'open');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Open Issues" value={health?.totalIssues ?? '—'} color={health && health.totalIssues > 0 ? TOK.expense : TOK.income} />
        <StatCard label="Expired Insurance" value={expIns.length} color={expIns.length ? TOK.expense : TOK.income} />
        <StatCard label="Expired Contracts" value={expContracts.length} color={expContracts.length ? TOK.warning : TOK.income} />
        <StatCard label="Open Disputes" value={openDisputes.length} color={openDisputes.length ? TOK.warning : TOK.income} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Section title="Expired Insurance (COI)" icon={<ShieldAlert size={13} style={{ color: TOK.expense }} />} count={expIns.length}>
          {expIns.length === 0 ? <Empty msg="All certificates of insurance are current." /> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {expIns.map((v: any) => (
                  <tr key={v.id} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td>{v.name}</Td><Td mono color={TOK.expense}>{formatDate(v.coi_expiry)}</Td>
                    <Td right><button className="block-btn text-[10px]" onClick={() => open(v.id)}>View</button></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
        <Section title="Expired Contracts" icon={<FileWarning size={13} style={{ color: TOK.warning }} />} count={expContracts.length}>
          {expContracts.length === 0 ? <Empty msg="No expired vendor contracts." /> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {expContracts.map((v: any) => (
                  <tr key={v.id} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td>{v.name}</Td><Td mono color={TOK.warning}>{formatDate(v.contract_end)}</Td>
                    <Td right><button className="block-btn text-[10px]" onClick={() => open(v.id)}>View</button></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>

      <Section title="Vendor Disputes" icon={<Gavel size={13} style={{ color: TOK.warning }} />} count={disputes.length}>
        {disputes.length === 0 ? <Empty msg="No vendor disputes on record." /> : (
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: `1px solid ${TOK.border}` }}><Th>Vendor</Th><Th>Bill #</Th><Th>Reason</Th><Th right>Amount</Th><Th>Status</Th><Th>Opened</Th><Th /></tr></thead>
              <tbody>
                {disputes.map((d: any) => (
                  <tr key={d.id} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td>{d.vendor_name || '—'}</Td><Td>{d.bill_number || '—'}</Td><Td>{(d.reason || '').slice(0, 40)}</Td>
                    <Td right mono>{formatCurrency(d.dispute_amount)}</Td>
                    <Td color={d.status === 'open' ? TOK.warning : TOK.income}>{d.status}</Td>
                    <Td mono>{formatDate(d.opened_date)}</Td>
                    <Td right><button className="block-btn text-[10px]" onClick={() => open(d.vendor_id)}>View</button></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Health Issues" icon={<ShieldCheck size={13} style={{ color: TOK.income }} />} count={health?.issues?.length}>
        {!health || !health.issues || health.issues.length === 0 ? <Empty msg="No open compliance issues." /> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {health.issues.map((iss: any, i: number) => (
                <tr key={i} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                  <Td>{iss.vendor || iss.name || '—'}</Td><Td>{iss.issue}</Td>
                  <Td right color={iss.severity === 'high' ? TOK.expense : TOK.warning}>{iss.severity}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
};

export default ComplianceHub;
