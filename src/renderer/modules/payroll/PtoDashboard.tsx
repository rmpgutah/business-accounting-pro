import React, { useEffect, useState, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

interface PtoBalance {
  id: string;
  employee_id: string;
  employee_name: string;
  policy_name: string;
  policy_id: string;
  balance_hours: number;
  used_hours_ytd: number;
  accrued_hours_ytd: number;
}

interface PtoPolicy {
  id: string;
  name: string;
  accrual_rate: number;
  accrual_unit: string;
  cap_hours: number | null;
  carry_over_limit: number;
}

const PtoDashboard: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [balances, setBalances] = useState<PtoBalance[]>([]);
  const [policies, setPolicies] = useState<PtoPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [adjustHours, setAdjustHours] = useState('');
  const [adjustNote, setAdjustNote] = useState('');
  const [adjustPolicyId, setAdjustPolicyId] = useState('');

  const load = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    const [bal, pol] = await Promise.all([
      api.listPtoBalances(activeCompany.id).catch(() => []),
      api.listPtoPolicies(activeCompany.id).catch(() => []),
    ]);
    setBalances(bal ?? []);
    setPolicies(pol ?? []);
    setLoading(false);
  }, [activeCompany]);

  useEffect(() => { load(); }, [load]);

  const handleAdjust = async (employeeId: string) => {
    if (!adjustHours || !adjustPolicyId) return;
    await api.adjustPto(employeeId, adjustPolicyId, parseFloat(adjustHours), adjustNote);
    setAdjusting(null);
    setAdjustHours('');
    setAdjustNote('');
    load();
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <span className="text-text-muted text-sm font-mono">Loading PTO data...</span>
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      {/* Policies */}
      <div className="block-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div className="text-xs font-semibold text-text-muted uppercase tracking-wider">PTO Policies</div>
        </div>
        {policies.length === 0 ? (
          <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
            No PTO policies defined. Create a policy to start tracking accruals.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {policies.map(p => (
              <div key={p.id} style={{ display: 'flex', gap: 16, padding: '8px 12px', background: 'var(--color-bg-secondary)', borderRadius: '6px', fontSize: '12px', alignItems: 'center' }}>
                <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', flex: 1 }}>{p.name}</div>
                <div style={{ color: 'var(--color-text-muted)' }}>{p.accrual_rate}h / {p.accrual_unit.replace(/_/g, ' ')}</div>
                {p.cap_hours != null && <div style={{ color: 'var(--color-text-muted)' }}>Cap: {p.cap_hours}h</div>}
                {p.carry_over_limit > 0 && <div style={{ color: 'var(--color-text-muted)' }}>Carry-over: {p.carry_over_limit}h</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Balances */}
      <div className="block-card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Employee PTO Balances</span>
          <button className="block-btn p-1" onClick={load} title="Refresh"><RefreshCw size={13} /></button>
        </div>
        {balances.length === 0 ? (
          <div style={{ padding: '24px', fontSize: '12px', color: 'var(--color-text-muted)', textAlign: 'center', fontStyle: 'italic' }}>
            No PTO balances yet. Balances accrue automatically with each payroll run.
          </div>
        ) : (
          <table className="block-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Policy</th>
                <th className="text-right">Balance (hrs)</th>
                <th className="text-right">Used YTD</th>
                <th className="text-right">Accrued YTD</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {balances.map(b => (
                <React.Fragment key={b.id}>
                  <tr>
                    <td className="font-semibold">{b.employee_name}</td>
                    <td className="text-text-muted text-xs">{b.policy_name || '—'}</td>
                    <td className="text-right font-mono" style={{ color: b.balance_hours < 8 ? '#ef4444' : 'var(--color-text-primary)' }}>
                      {Number(b.balance_hours).toFixed(1)}h
                    </td>
                    <td className="text-right font-mono text-text-secondary">{Number(b.used_hours_ytd).toFixed(1)}h</td>
                    <td className="text-right font-mono text-text-secondary">{Number(b.accrued_hours_ytd).toFixed(1)}h</td>
                    <td className="text-center">
                      <button
                        className="block-btn text-xs py-1 px-2"
                        onClick={() => { setAdjusting(b.employee_id); setAdjustPolicyId(b.policy_id); }}
                      >
                        Adjust
                      </button>
                    </td>
                  </tr>
                  {adjusting === b.employee_id && (
                    <tr>
                      <td colSpan={6} style={{ padding: '8px 12px', background: 'var(--color-bg-secondary)' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <input
                            type="number"
                            step="0.5"
                            className="block-input"
                            style={{ width: 100 }}
                            placeholder="Hours (±)"
                            value={adjustHours}
                            onChange={(e) => setAdjustHours(e.target.value)}
                          />
                          <input
                            className="block-input"
                            style={{ flex: 1 }}
                            placeholder="Reason..."
                            value={adjustNote}
                            onChange={(e) => setAdjustNote(e.target.value)}
                          />
                          <button className="block-btn text-xs py-1 px-3" onClick={() => handleAdjust(b.employee_id)}>Apply</button>
                          <button className="block-btn text-xs py-1 px-2" onClick={() => setAdjusting(null)}>Cancel</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default PtoDashboard;
