// src/renderer/modules/subscriptions/PhantomTab.tsx
//
// Feature #34 — Phantom-subscription detector.
// Scans recurring charges to detect subscriptions the business may not be
// actively tracking. Confirm = keep / Cancel = stop tracking.
// Uses: featSubDetectScan, featSubDetectSummary, featSubDetectConfirm, featSubDetectCancel.

import React, { useEffect, useState, useCallback } from 'react';
import { ScanSearch, CheckCircle, XCircle, DollarSign } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import { Section, Empty, StatCard, Th, Td, TOK } from './shared/ui';

const PhantomTab: React.FC = () => {
  const [summary, setSummary] = useState<any>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<any>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [actionBusy, setActionBusy] = useState<Record<string, boolean>>({});
  const [reload, setReload] = useState(0);

  const refresh = useCallback(() => setReload((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoadingSummary(true);
    api.featSubDetectSummary()
      .then((r: any) => {
        if (!cancelled && r && !r.error) setSummary(r);
        if (!cancelled) setLoadingSummary(false);
      })
      .catch(() => { if (!cancelled) setLoadingSummary(false); });
    return () => { cancelled = true; };
  }, [reload]);

  const handleScan = async () => {
    setScanning(true); setScanResult(null);
    try {
      const res = await api.featSubDetectScan(180);
      if (res?.error) alert(`Scan error: ${res.error}`);
      else { setScanResult(res); refresh(); }
    } catch (e: any) { alert(e?.message || 'Scan failed'); }
    finally { setScanning(false); }
  };

  const handleConfirm = async (id: string, confirmed: boolean) => {
    const verb = confirmed ? 'confirm' : 'unconfirm';
    if (!window.confirm(`${verb.charAt(0).toUpperCase() + verb.slice(1)} this detected subscription?`)) return;
    setActionBusy((b) => ({ ...b, [id]: true }));
    try {
      const res = await api.featSubDetectConfirm(id, confirmed);
      if (res?.error) alert(res.error);
      else refresh();
    } catch (e: any) { alert(e?.message || 'Error'); }
    finally { setActionBusy((b) => ({ ...b, [id]: false })); }
  };

  const handleCancel = async (id: string) => {
    if (!window.confirm('Mark this detected subscription as cancelled? It will be removed from the phantom list.')) return;
    setActionBusy((b) => ({ ...b, [id]: true }));
    try {
      const res = await api.featSubDetectCancel(id);
      if (res?.error) alert(res.error);
      else refresh();
    } catch (e: any) { alert(e?.message || 'Error'); }
    finally { setActionBusy((b) => ({ ...b, [id]: false })); }
  };

  const detected: any[] = summary?.by_subscription || [];

  return (
    <div className="space-y-4">
      {/* Summary KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard
          label="Detected Subscriptions"
          value={loadingSummary ? '…' : summary?.subscription_count ?? 0}
          sub="recurring charge patterns"
        />
        <StatCard
          label="Total Annual Exposure"
          value={loadingSummary ? '…' : summary?.total_annual != null ? formatCurrency(summary.total_annual) : '—'}
          sub="all unconfirmed recurring charges"
          color={summary?.total_annual > 1000 ? TOK.warning : undefined}
        />
        <div className="block-card p-3 flex flex-col justify-between">
          <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">Scan (180d lookback)</div>
          <button
            className="block-btn flex items-center gap-1.5 text-xs px-3 py-1.5 mt-2 self-start"
            onClick={handleScan}
            disabled={scanning}
          >
            <ScanSearch size={12} /> {scanning ? 'Scanning…' : 'Run Scan'}
          </button>
          {scanResult && (
            <div className="text-[10px] mt-1" style={{ color: scanResult.detected > 0 ? TOK.warning : TOK.income }}>
              {scanResult.detected} pattern{scanResult.detected !== 1 ? 's' : ''} detected
            </div>
          )}
        </div>
      </div>

      {/* Detected subscription list */}
      <Section
        title="Detected Recurring Charges"
        icon={<DollarSign size={13} style={{ color: TOK.warning }} />}
        count={detected.length}
      >
        {loadingSummary ? (
          <div className="px-4 py-3 text-[11px] text-text-muted">Loading…</div>
        ) : detected.length === 0 ? (
          <Empty msg="No phantom subscriptions detected. Run a scan to check your expense history." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${TOK.border}` }}>
                  <Th>Vendor</Th>
                  <Th right>Amount</Th>
                  <Th>Frequency</Th>
                  <Th right>Annual Cost</Th>
                  <Th right>Occurrences</Th>
                  <Th>Last Charge</Th>
                  <Th>Next Expected</Th>
                  <Th>Status</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {detected.map((d: any) => (
                  <tr key={d.id} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td>{d.vendor_name || d.vendor_id || '—'}</Td>
                    <Td right mono>{formatCurrency(d.avg_amount)}</Td>
                    <Td>
                      <span className="text-[10px] font-bold px-1.5 py-0.5" style={{ borderRadius: 4, color: TOK.blue, background: 'color-mix(in srgb, var(--color-accent-blue) 12%, transparent)' }}>
                        {(d.frequency || 'unknown').toUpperCase()}
                      </span>
                    </Td>
                    <Td right mono color={TOK.warning}>{formatCurrency(d.annual_cost)}</Td>
                    <Td right mono>{d.occurrence_count ?? '—'}</Td>
                    <Td>{d.last_charge_date ? formatDate(d.last_charge_date) : '—'}</Td>
                    <Td>{d.next_expected_date ? formatDate(d.next_expected_date) : '—'}</Td>
                    <Td>
                      {d.is_confirmed ? (
                        <span className="text-[10px] font-bold" style={{ color: TOK.income }}>CONFIRMED</span>
                      ) : (
                        <span className="text-[10px] font-bold" style={{ color: TOK.warning }}>UNCONFIRMED</span>
                      )}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        <button
                          title={d.is_confirmed ? 'Unconfirm' : 'Confirm as known subscription'}
                          disabled={!!actionBusy[d.id]}
                          className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{ color: TOK.income, background: 'color-mix(in srgb, var(--color-accent-income) 12%, transparent)' }}
                          onClick={() => handleConfirm(d.id, !d.is_confirmed)}
                        >
                          <CheckCircle size={10} />
                        </button>
                        <button
                          title="Mark as cancelled"
                          disabled={!!actionBusy[d.id]}
                          className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{ color: TOK.expense, background: 'color-mix(in srgb, var(--color-accent-expense) 12%, transparent)' }}
                          onClick={() => handleCancel(d.id)}
                        >
                          <XCircle size={10} />
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
    </div>
  );
};

export default PhantomTab;
