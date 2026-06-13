// src/renderer/modules/vendors-ap/PortalAdmin.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { Inbox, Landmark, Check, X } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import { useAuthStore } from '../../stores/authStore';
import { Section, Empty, Th, Td, TOK } from './shared/ui';

// Proposed bank info is stored already masked (account last-4 only); routing is a public bank identifier.
const maskAccount = (u: any) => `${u.account_type || 'checking'} ••••${u.account_number_last4 || '????'}`;

const PortalAdmin: React.FC = () => {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [poResponses, setPoResponses] = useState<any[]>([]);
  const [achUpdates, setAchUpdates] = useState<any[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const reviewerId = useAuthStore((s) => s.user?.id) || 'owner';

  const load = useCallback(() => {
    let cancelled = false;
    const arr = (s: (v: any[]) => void) => (r: any) => { if (!cancelled && Array.isArray(r)) s(r); };
    api.featVendorInvList().then(arr(setInvoices)).catch(() => {});
    api.featVendorPoListResponses().then(arr(setPoResponses)).catch(() => {});
    api.featVendorAchList().then(arr(setAchUpdates)).catch(() => {});
    return () => { cancelled = true; };
  }, [reloadKey]);
  useEffect(() => load(), [load]);

  const review = (id: string, status: 'approved' | 'rejected') =>
    api.featVendorInvReview(id, status, reviewerId).then(() => setReloadKey(k => k + 1)).catch(() => {});

  const reviewAch = (id: string, decision: 'approve' | 'reject') =>
    (decision === 'approve' ? api.featVendorAchApprove(id, reviewerId) : api.featVendorAchReject(id, reviewerId))
      .then(() => setReloadKey(k => k + 1)).catch(() => {});

  return (
    <div className="space-y-4">
      <Section title="Submitted Invoices (Vendor Portal)" icon={<Inbox size={13} style={{ color: TOK.blue }} />} count={invoices.length}>
        {invoices.length === 0 ? <Empty msg="No vendor-submitted invoices awaiting review." /> : (
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: `1px solid ${TOK.border}` }}><Th>Submitted</Th><Th>Vendor</Th><Th>Invoice #</Th><Th right>Amount</Th><Th>Status</Th><Th right /></tr></thead>
              <tbody>
                {invoices.map((s: any) => (
                  <tr key={s.id} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td mono>{formatDate(s.created_at || s.submitted_at)}</Td>
                    <Td>{s.vendor_name || s.vendor_id}</Td><Td>{s.invoice_number || '—'}</Td>
                    <Td right mono>{formatCurrency(s.amount)}</Td>
                    <Td color={s.status === 'approved' ? TOK.income : s.status === 'rejected' ? TOK.expense : TOK.warning}>{s.status || 'pending'}</Td>
                    <Td right>
                      {(!s.status || s.status === 'pending') && (
                        <div className="flex gap-1 justify-end">
                          <button className="block-btn text-[10px]" style={{ color: TOK.income }} onClick={() => review(s.id, 'approved')}><Check size={11} /></button>
                          <button className="block-btn text-[10px]" style={{ color: TOK.expense }} onClick={() => review(s.id, 'rejected')}><X size={11} /></button>
                        </div>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="PO Responses" icon={<Inbox size={13} style={{ color: TOK.blue }} />} count={poResponses.length}>
        {poResponses.length === 0 ? <Empty msg="No purchase-order responses from vendors." /> : (
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: `1px solid ${TOK.border}` }}><Th>Date</Th><Th>PO</Th><Th>Vendor</Th><Th>Response</Th></tr></thead>
              <tbody>
                {poResponses.map((p: any) => (
                  <tr key={p.id} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td mono>{formatDate(p.created_at)}</Td><Td>{p.po_number || p.po_id}</Td>
                    <Td>{p.vendor_name || p.vendor_id}</Td><Td>{p.response || p.status}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Bank-Info Change Requests" icon={<Landmark size={13} style={{ color: TOK.blue }} />} count={achUpdates.length}>
        {achUpdates.length === 0 ? <Empty msg="No vendor bank-info (ACH) change requests." /> : (
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: `1px solid ${TOK.border}` }}><Th>Submitted</Th><Th>Vendor</Th><Th>Proposed Account</Th><Th>Routing</Th><Th>Status</Th><Th right /></tr></thead>
              <tbody>
                {achUpdates.map((u: any) => (
                  <tr key={u.id} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td mono>{formatDate(u.submitted_at)}</Td>
                    <Td>{u.vendor_name || u.vendor_id}</Td>
                    <Td mono>{maskAccount(u)}</Td>
                    <Td mono>{u.routing_number || '—'}</Td>
                    <Td color={u.status === 'approved' ? TOK.income : u.status === 'rejected' ? TOK.expense : TOK.warning}>{u.status || 'pending'}</Td>
                    <Td right>
                      {(!u.status || u.status === 'pending') && (
                        <div className="flex gap-1 justify-end">
                          <button className="block-btn text-[10px]" style={{ color: TOK.income }} onClick={() => reviewAch(u.id, 'approve')}><Check size={11} /></button>
                          <button className="block-btn text-[10px]" style={{ color: TOK.expense }} onClick={() => reviewAch(u.id, 'reject')}><X size={11} /></button>
                        </div>
                      )}
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

export default PortalAdmin;
