// src/renderer/modules/vendors-ap/TaxCompliance1099.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { FileText, RefreshCw } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import { Section, Empty, Th, Td, StatCard, TOK } from './shared/ui';

const YEAR = new Date().getFullYear();

const TaxCompliance1099: React.FC<{ onViewVendor?: (id: string) => void }> = ({ onViewVendor }) => {
  const [needing, setNeeding] = useState<any[]>([]);
  const [withoutW9, setWithoutW9] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    const arr = (s: (v: any[]) => void) => (r: any) => { if (!cancelled && Array.isArray(r)) s(r); };
    api.vnNeeding1099().then(arr(setNeeding)).catch(() => {});
    api.vnWithoutW9().then(arr(setWithoutW9)).catch(() => {});
    api.feat1099RunList().then(arr(setRuns)).catch(() => {});
    return () => { cancelled = true; };
  }, [reloadKey]);
  useEffect(() => load(), [load]);

  const open = (id: string) => { if (id && onViewVendor) onViewVendor(id); };
  const recalc = () => { setBusy(true); api.featVendor1099Recalc(YEAR).then(() => { setBusy(false); setReloadKey(k => k + 1); }).catch(() => setBusy(false)); };
  const createRun = () => { api.feat1099RunCreate({ tax_year: YEAR }).then(() => setReloadKey(k => k + 1)).catch(() => {}); };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label={`Requires 1099 (${YEAR})`} value={needing.length} sub="paid ≥ $600" color={needing.length ? TOK.warning : TOK.income} />
        <StatCard label="Missing W-9" value={withoutW9.length} sub="1099-eligible, no W-9" color={withoutW9.length ? TOK.expense : TOK.income} />
        <StatCard label="Filing Runs" value={runs.length} />
      </div>

      <Section title={`Vendors Requiring 1099 (${YEAR})`} icon={<FileText size={13} style={{ color: TOK.warning }} />} count={needing.length}
        right={<div className="flex gap-1"><button className="block-btn text-[10px] flex items-center gap-1" onClick={recalc} disabled={busy}><RefreshCw size={11} /> {busy ? 'Recalculating…' : 'Recalc YTD'}</button><button className="block-btn block-btn-primary text-[10px]" onClick={createRun}>Create Filing Run</button></div>}>
        {needing.length === 0 ? <Empty msg="No vendors cross the $600 reporting threshold this year." /> : (
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: `1px solid ${TOK.border}` }}><Th>Vendor</Th><Th>TIN</Th><Th right>YTD Paid</Th><Th /></tr></thead>
              <tbody>
                {needing.map((v: any) => (
                  <tr key={v.id} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td>{v.name}</Td><Td mono>{v.tax_id_last4 ? `•••${v.tax_id_last4}` : <span style={{ color: TOK.expense }}>missing</span>}</Td>
                    <Td right mono>{formatCurrency(v.ytd_paid)}</Td>
                    <Td right><button className="block-btn text-[10px]" onClick={() => open(v.id)}>View</button></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="grid md:grid-cols-2 gap-4">
        <Section title="Missing W-9" icon={<FileText size={13} style={{ color: TOK.expense }} />} count={withoutW9.length}>
          {withoutW9.length === 0 ? <Empty msg="Every 1099-eligible vendor has a current W-9." /> : (
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {withoutW9.map((v: any) => (
                    <tr key={v.id} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                      <Td>{v.name}</Td>
                      <Td right><button className="block-btn text-[10px]" onClick={() => open(v.id)}>Request W-9</button></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
        <Section title="Filing Runs" icon={<FileText size={13} style={{ color: TOK.blue }} />} count={runs.length}>
          {runs.length === 0 ? <Empty msg="No filing runs yet." /> : (
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: `1px solid ${TOK.border}` }}><Th>Year</Th><Th>Form</Th><Th right>Vendors</Th><Th right>Total</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {runs.map((r: any) => (
                    <tr key={r.id} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                      <Td mono>{r.tax_year}</Td><Td>{r.form_type}</Td><Td right mono>{r.vendor_count}</Td>
                      <Td right mono>{formatCurrency(r.total_amount)}</Td><Td>{r.status}</Td>
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

export default TaxCompliance1099;
