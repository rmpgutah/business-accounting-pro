// src/renderer/modules/vendors-ap/ApprovalsWorkbench.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { CheckSquare, Check, X } from 'lucide-react';
import api from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useAuthStore } from '../../stores/authStore';
import { Section, Empty, Th, Td, TOK } from './shared/ui';

const ApprovalsWorkbench: React.FC = () => {
  const [pending, setPending] = useState<any[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const actorId = useAuthStore((s) => s.user?.id) || 'owner';

  const load = useCallback(() => {
    let cancelled = false;
    api.featApprovalPending().then((r: any) => { if (!cancelled && Array.isArray(r)) setPending(r); }).catch(() => {});
    return () => { cancelled = true; };
  }, [reloadKey]);
  useEffect(() => load(), [load]);

  const act = (instanceId: string, action: 'approve' | 'reject') => {
    api.featApprovalAct(instanceId, action, actorId).then(() => setReloadKey(k => k + 1)).catch(() => {});
  };

  return (
    <div className="space-y-4">
      <Section title="Pending Approvals" icon={<CheckSquare size={13} style={{ color: TOK.warning }} />} count={pending.length}>
        {pending.length === 0 ? <Empty msg="Nothing awaiting approval. Bills and POs above your chain thresholds appear here." /> : (
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: `1px solid ${TOK.border}` }}><Th>Type</Th><Th>Reference</Th><Th>Submitted</Th><Th right>Step</Th><Th right>Action</Th></tr></thead>
              <tbody>
                {pending.map((a: any) => (
                  <tr key={a.id} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td>{(a.entity_type || '').replace(/_/g, ' ')}</Td>
                    <Td>{a.entity_ref || a.entity_id}</Td>
                    <Td mono>{formatDate(a.submitted_at)}{a.submitted_by ? ` · ${a.submitted_by}` : ''}</Td>
                    <Td right mono>{a.current_step != null ? `#${a.current_step}` : '—'}</Td>
                    <Td right>
                      <div className="flex gap-1 justify-end">
                        <button className="block-btn text-[10px]" style={{ color: TOK.income }} onClick={() => act(a.id, 'approve')}><Check size={11} /> Approve</button>
                        <button className="block-btn text-[10px]" style={{ color: TOK.expense }} onClick={() => act(a.id, 'reject')}><X size={11} /> Reject</button>
                      </div>
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

export default ApprovalsWorkbench;
