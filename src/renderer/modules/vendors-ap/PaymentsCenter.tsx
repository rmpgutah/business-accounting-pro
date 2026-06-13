// src/renderer/modules/vendors-ap/PaymentsCenter.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { Banknote, FileCheck2, Printer } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import { Section, Empty, Th, Td, TOK } from './shared/ui';

const PaymentsCenter: React.FC = () => {
  const [achBatches, setAchBatches] = useState<any[]>([]);
  const [posPay, setPosPay] = useState<any[]>([]);
  const [checks, setChecks] = useState<any[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(() => {
    let cancelled = false;
    const arr = (s: (v: any[]) => void) => (r: any) => { if (!cancelled && Array.isArray(r)) s(r); };
    api.featAchBatchList().then(arr(setAchBatches)).catch(() => {});
    api.featPositivePayList().then(arr(setPosPay)).catch(() => {});
    api.featCheckPrintList().then(arr(setChecks)).catch(() => {});
    return () => { cancelled = true; };
  }, [reloadKey]);
  useEffect(() => load(), [load]);

  const markAch = (id: string) => api.featAchBatchMarkSubmitted(id).then(() => setReloadKey(k => k + 1)).catch(() => {});
  const markPos = (id: string) => api.featPositivePayMarkSubmitted(id).then(() => setReloadKey(k => k + 1)).catch(() => {});

  return (
    <div className="space-y-4">
      <Section title="ACH Batches" icon={<Banknote size={13} style={{ color: TOK.blue }} />} count={achBatches.length}>
        {achBatches.length === 0 ? <Empty msg="No ACH batches. Create one from approved bills to generate a NACHA file." /> : (
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: `1px solid ${TOK.border}` }}><Th>Batch Date</Th><Th>Effective</Th><Th right>Items</Th><Th right>Credit</Th><Th>Status</Th><Th right /></tr></thead>
              <tbody>
                {achBatches.map((b: any) => (
                  <tr key={b.id} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td mono>{formatDate(b.batch_date)}</Td><Td mono>{formatDate(b.effective_date)}</Td>
                    <Td right mono>{b.item_count}</Td><Td right mono>{formatCurrency(b.total_credit)}</Td>
                    <Td color={b.status === 'submitted' ? TOK.income : TOK.warning}>{b.status}</Td>
                    <Td right>{b.status !== 'submitted' && <button className="block-btn text-[10px]" onClick={() => markAch(b.id)}>Mark Submitted</button>}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Positive Pay Files" icon={<FileCheck2 size={13} style={{ color: TOK.blue }} />} count={posPay.length}>
        {posPay.length === 0 ? <Empty msg="No positive-pay files generated." /> : (
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: `1px solid ${TOK.border}` }}><Th>Created</Th><Th>File</Th><Th>Status</Th><Th right /></tr></thead>
              <tbody>
                {posPay.map((f: any) => (
                  <tr key={f.id} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td mono>{formatDate(f.created_at)}</Td><Td>{f.file_path || f.filename || '—'}</Td>
                    <Td color={f.status === 'submitted' ? TOK.income : TOK.warning}>{f.status}</Td>
                    <Td right>{f.status !== 'submitted' && <button className="block-btn text-[10px]" onClick={() => markPos(f.id)}>Mark Submitted</button>}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Check Print Runs" icon={<Printer size={13} style={{ color: TOK.blue }} />} count={checks.length}>
        {checks.length === 0 ? <Empty msg="No check-print jobs recorded." /> : (
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: `1px solid ${TOK.border}` }}><Th>Printed</Th><Th right>Range</Th><Th right>Count</Th><Th right>Total</Th></tr></thead>
              <tbody>
                {checks.map((c: any) => (
                  <tr key={c.id} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td mono>{formatDate(c.printed_at)}</Td>
                    <Td right mono>{c.check_number_start}–{c.check_number_end}</Td>
                    <Td right mono>{c.check_count}</Td><Td right mono>{formatCurrency(c.total_amount)}</Td>
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

export default PaymentsCenter;
