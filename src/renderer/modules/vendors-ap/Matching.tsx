// src/renderer/modules/vendors-ap/Matching.tsx
//
// 3-way match UI for the Vendor & AP Command Center.
// Sections: KPI strip · Unmatched Bills (link PO) · Match Exceptions · Touchless Auto-Approve.

import React, { useEffect, useRef, useState } from 'react';
import { Link2, AlertTriangle, CheckCircle2, Zap } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import { useNavigation } from '../../lib/navigation';
import { Section, Empty, Th, Td, StatCard, TOK } from './shared/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UnmatchedBill {
  bill_id: string;
  bill_number: string;
  vendor_id: string;
  vendor_name: string;
  total: number;
  due_date: string;
}

interface PO {
  po_id: string;
  po_number: string;
  total: number;
}

interface MatchLine {
  description: string;
  bill_qty: number;
  po_received_qty: number;
  qty_variance: number;
  bill_price: number;
  po_price: number;
  price_variance: number;
  status: string;
}

interface MatchResult {
  bill_id: string;
  bill_number: string;
  vendor_name: string;
  po_number: string;
  status: string;
  totalVarianceAmount: number;
  lines: MatchLine[];
}

interface Exception extends MatchResult {}

// ─── Status badge coloring ────────────────────────────────────────────────────

function statusColor(status: string): string {
  const s = (status || '').toLowerCase();
  if (s === 'matched' || s === 'clean') return TOK.income;
  if (s === 'exception' || s === 'mismatch') return TOK.expense;
  if (s === 'partial') return TOK.warning;
  return TOK.blue;
}

function lineStatusColor(status: string): string {
  const s = (status || '').toLowerCase();
  if (s === 'matched') return TOK.income;
  return TOK.expense;
}

// ─── Unmatched Bills section ──────────────────────────────────────────────────

interface LinkState {
  loading: boolean;
  pos: PO[];
  selectedPoId: string;
  linking: boolean;
  linkedLines: number | null;
}

const UnmatchedBillsSection: React.FC<{ onLinked: () => void }> = ({ onLinked }) => {
  const [bills, setBills] = useState<UnmatchedBill[]>([]);
  const [loading, setLoading] = useState(true);
  const cancelledRef = useRef(false);

  // Per-row link state
  const [linkStates, setLinkStates] = useState<Record<string, LinkState>>({});

  useEffect(() => {
    cancelledRef.current = false;
    setLoading(true);
    api.vnUnmatchedBills().then((rows: UnmatchedBill[]) => {
      if (cancelledRef.current) return;
      setBills(rows || []);
      setLoading(false);
    }).catch(() => {
      if (!cancelledRef.current) setLoading(false);
    });
    return () => { cancelledRef.current = true; };
  }, []);

  const openLinkPicker = async (bill: UnmatchedBill) => {
    setLinkStates(prev => ({
      ...prev,
      [bill.bill_id]: { loading: true, pos: [], selectedPoId: '', linking: false, linkedLines: null },
    }));
    try {
      const pos: PO[] = await api.vnPosForVendor(bill.vendor_id) || [];
      setLinkStates(prev => ({
        ...prev,
        [bill.bill_id]: { ...prev[bill.bill_id], loading: false, pos },
      }));
    } catch {
      setLinkStates(prev => ({
        ...prev,
        [bill.bill_id]: { ...prev[bill.bill_id], loading: false, pos: [] },
      }));
    }
  };

  const closeLinkPicker = (billId: string) => {
    setLinkStates(prev => {
      const next = { ...prev };
      delete next[billId];
      return next;
    });
  };

  const doLink = async (billId: string) => {
    const ls = linkStates[billId];
    if (!ls || !ls.selectedPoId) return;
    setLinkStates(prev => ({ ...prev, [billId]: { ...prev[billId], linking: true } }));
    try {
      const result: { ok: boolean; linkedLines: number } = await api.vnLinkBillPo(billId, ls.selectedPoId);
      setLinkStates(prev => ({
        ...prev,
        [billId]: { ...prev[billId], linking: false, linkedLines: result.linkedLines },
      }));
      // Remove the bill from the list after a short display
      setTimeout(() => {
        setBills(prev => prev.filter(b => b.bill_id !== billId));
        setLinkStates(prev => { const n = { ...prev }; delete n[billId]; return n; });
        onLinked();
      }, 1500);
    } catch {
      setLinkStates(prev => ({ ...prev, [billId]: { ...prev[billId], linking: false } }));
    }
  };

  if (loading) return <div className="px-4 py-3 text-[11px] text-text-muted">Loading…</div>;
  if (!bills.length) return <Empty msg="No unmatched bills — all bills are linked to purchase orders." />;

  return (
    <table className="block-table w-full">
      <thead>
        <tr>
          <Th>Bill #</Th>
          <Th>Vendor</Th>
          <Th right>Total</Th>
          <Th>Due Date</Th>
          <Th>Action</Th>
        </tr>
      </thead>
      <tbody>
        {bills.map(bill => {
          const ls = linkStates[bill.bill_id];
          return (
            <React.Fragment key={bill.bill_id}>
              <tr>
                <Td mono>{bill.bill_number || '—'}</Td>
                <Td>{bill.vendor_name}</Td>
                <Td right mono color={TOK.expense}>{formatCurrency(bill.total)}</Td>
                <Td>{bill.due_date ? new Date(bill.due_date).toLocaleDateString() : '—'}</Td>
                <Td>
                  {ls ? (
                    <button
                      onClick={() => closeLinkPicker(bill.bill_id)}
                      style={{ fontSize: 10, color: TOK.muted, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
                    >
                      Cancel
                    </button>
                  ) : (
                    <button
                      onClick={() => openLinkPicker(bill)}
                      className="block-btn"
                      style={{ fontSize: 10, padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    >
                      <Link2 size={10} /> Link PO
                    </button>
                  )}
                </Td>
              </tr>
              {ls && (
                <tr style={{ background: 'var(--color-bg-secondary)' }}>
                  <td colSpan={5} style={{ padding: '6px 10px' }}>
                    {ls.linkedLines !== null ? (
                      <span style={{ fontSize: 11, color: TOK.income }}>
                        <CheckCircle2 size={11} style={{ display: 'inline', marginRight: 4 }} />
                        Linked {ls.linkedLines} line{ls.linkedLines !== 1 ? 's' : ''} successfully.
                      </span>
                    ) : ls.loading ? (
                      <span style={{ fontSize: 11, color: TOK.muted }}>Loading POs…</span>
                    ) : ls.pos.length === 0 ? (
                      <span style={{ fontSize: 11, color: TOK.muted }}>No open POs found for this vendor.</span>
                    ) : (
                      <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                        <select
                          value={ls.selectedPoId}
                          onChange={e => setLinkStates(prev => ({ ...prev, [bill.bill_id]: { ...prev[bill.bill_id], selectedPoId: e.target.value } }))}
                          className="block-input"
                          style={{ fontSize: 11, padding: '2px 6px', minWidth: 200 }}
                        >
                          <option value="">— Select PO —</option>
                          {ls.pos.map(po => (
                            <option key={po.po_id} value={po.po_id}>
                              {po.po_number} ({formatCurrency(po.total)})
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => doLink(bill.bill_id)}
                          disabled={!ls.selectedPoId || ls.linking}
                          className="block-btn"
                          style={{ fontSize: 10, padding: '2px 8px', opacity: (!ls.selectedPoId || ls.linking) ? 0.5 : 1 }}
                        >
                          {ls.linking ? 'Linking…' : 'Confirm Link'}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
};

// ─── Match Exceptions section ─────────────────────────────────────────────────

const ExceptionsSection: React.FC = () => {
  const [exceptions, setExceptions] = useState<Exception[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const cancelledRef = useRef(false);
  const { goTo } = useNavigation();

  useEffect(() => {
    cancelledRef.current = false;
    setLoading(true);
    api.vnMatchExceptions().then((rows: Exception[]) => {
      if (cancelledRef.current) return;
      setExceptions(rows || []);
      setLoading(false);
    }).catch(() => {
      if (!cancelledRef.current) setLoading(false);
    });
    return () => { cancelledRef.current = true; };
  }, []);

  const toggle = (billId: string) => setExpanded(prev => ({ ...prev, [billId]: !prev[billId] }));

  if (loading) return <div className="px-4 py-3 text-[11px] text-text-muted">Loading…</div>;
  if (!exceptions.length) return <Empty msg="No match exceptions — all matched bills are within tolerance." />;

  return (
    <table className="block-table w-full">
      <thead>
        <tr>
          <Th>Bill #</Th>
          <Th>Vendor</Th>
          <Th>PO #</Th>
          <Th>Status</Th>
          <Th right>Variance $</Th>
          <Th>Action</Th>
        </tr>
      </thead>
      <tbody>
        {exceptions.map(ex => (
          <React.Fragment key={ex.bill_id}>
            <tr
              onClick={() => toggle(ex.bill_id)}
              style={{ cursor: 'pointer' }}
            >
              <Td mono>{ex.bill_number || '—'}</Td>
              <Td>{ex.vendor_name}</Td>
              <Td mono>{ex.po_number || '—'}</Td>
              <Td>
                <span style={{
                  fontSize: 9,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: 0.6,
                  color: statusColor(ex.status),
                  background: `color-mix(in srgb, ${statusColor(ex.status)} 12%, transparent)`,
                  padding: '2px 6px',
                  borderRadius: 4,
                }}>
                  {ex.status || 'unknown'}
                </span>
              </Td>
              <Td right mono color={ex.totalVarianceAmount !== 0 ? TOK.expense : TOK.income}>
                {formatCurrency(ex.totalVarianceAmount)}
              </Td>
              <Td>
                <button
                  onClick={e => { e.stopPropagation(); goTo('bills'); }}
                  style={{
                    fontSize: 10,
                    color: TOK.brand,
                    background: 'none',
                    border: `1px solid ${TOK.brand}`,
                    borderRadius: 4,
                    padding: '2px 8px',
                    cursor: 'pointer',
                  }}
                >
                  View Bill
                </button>
              </Td>
            </tr>
            {expanded[ex.bill_id] && ex.lines && ex.lines.length > 0 && (
              <tr style={{ background: 'var(--color-bg-secondary)' }}>
                <td colSpan={6} style={{ padding: '6px 16px 10px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${TOK.border}` }}>
                        <th style={{ textAlign: 'left', padding: '3px 6px', color: TOK.muted, textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 9 }}>Description</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px', color: TOK.muted, textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 9 }}>Bill Qty</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px', color: TOK.muted, textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 9 }}>PO Rcvd</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px', color: TOK.muted, textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 9 }}>Qty Var</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px', color: TOK.muted, textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 9 }}>Bill $</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px', color: TOK.muted, textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 9 }}>PO $</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px', color: TOK.muted, textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 9 }}>Price Var</th>
                        <th style={{ textAlign: 'left', padding: '3px 6px', color: TOK.muted, textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 9 }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ex.lines.map((ln, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid color-mix(in srgb, ${TOK.border} 50%, transparent)` }}>
                          <td style={{ padding: '3px 6px', color: 'var(--color-text-primary)' }}>{ln.description || '—'}</td>
                          <td style={{ textAlign: 'right', padding: '3px 6px', fontFamily: 'SF Mono, Menlo, monospace' }}>{ln.bill_qty ?? '—'}</td>
                          <td style={{ textAlign: 'right', padding: '3px 6px', fontFamily: 'SF Mono, Menlo, monospace' }}>{ln.po_received_qty ?? '—'}</td>
                          <td style={{ textAlign: 'right', padding: '3px 6px', fontFamily: 'SF Mono, Menlo, monospace', color: ln.qty_variance !== 0 ? TOK.expense : TOK.income }}>{ln.qty_variance ?? '—'}</td>
                          <td style={{ textAlign: 'right', padding: '3px 6px', fontFamily: 'SF Mono, Menlo, monospace' }}>{formatCurrency(ln.bill_price)}</td>
                          <td style={{ textAlign: 'right', padding: '3px 6px', fontFamily: 'SF Mono, Menlo, monospace' }}>{formatCurrency(ln.po_price)}</td>
                          <td style={{ textAlign: 'right', padding: '3px 6px', fontFamily: 'SF Mono, Menlo, monospace', color: ln.price_variance !== 0 ? TOK.expense : TOK.income }}>{formatCurrency(ln.price_variance)}</td>
                          <td style={{ padding: '3px 6px' }}>
                            <span style={{
                              fontSize: 8,
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              letterSpacing: 0.5,
                              color: lineStatusColor(ln.status),
                              background: `color-mix(in srgb, ${lineStatusColor(ln.status)} 12%, transparent)`,
                              padding: '1px 5px',
                              borderRadius: 3,
                            }}>
                              {ln.status || 'unknown'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </td>
              </tr>
            )}
          </React.Fragment>
        ))}
      </tbody>
    </table>
  );
};

// ─── KPI strip ────────────────────────────────────────────────────────────────

interface KpiData {
  matchedCount: number;
  exceptionsCount: number;
  unmatchedCount: number;
  totalVariance: number;
}

// ─── Main component ───────────────────────────────────────────────────────────

interface MatchingProps {
  onViewVendor?: (id: string) => void;
}

const Matching: React.FC<MatchingProps> = () => {
  const [kpi, setKpi] = useState<KpiData>({ matchedCount: 0, exceptionsCount: 0, unmatchedCount: 0, totalVariance: 0 });
  const [kpiLoading, setKpiLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  // Auto-approve controls
  const [maxAmount, setMaxAmount] = useState<number>(500);
  const [approving, setApproving] = useState(false);
  const [approveResult, setApproveResult] = useState<{ approvedCount: number } | null>(null);

  const cancelledRef = useRef(false);

  // Load KPI data from match results
  useEffect(() => {
    cancelledRef.current = false;
    setKpiLoading(true);
    api.vnMatchResults().then((results: MatchResult[]) => {
      if (cancelledRef.current) return;
      const rows = results || [];
      const matched = rows.filter(r => (r.status || '').toLowerCase() === 'matched' || (r.status || '').toLowerCase() === 'clean');
      const exceptions = rows.filter(r => (r.status || '').toLowerCase() !== 'matched' && (r.status || '').toLowerCase() !== 'clean');
      const totalVariance = rows.reduce((sum, r) => sum + (r.totalVarianceAmount || 0), 0);
      setKpi({
        matchedCount: matched.length,
        exceptionsCount: exceptions.length,
        unmatchedCount: 0, // filled from unmatched bills separately
        totalVariance,
      });
      setKpiLoading(false);
    }).catch(() => {
      if (!cancelledRef.current) setKpiLoading(false);
    });

    // Also fetch unmatched count for KPI
    api.vnUnmatchedBills().then((rows: UnmatchedBill[]) => {
      if (cancelledRef.current) return;
      setKpi(prev => ({ ...prev, unmatchedCount: (rows || []).length }));
    }).catch(() => {});

    return () => { cancelledRef.current = true; };
  }, [reloadKey]);

  const handleAutoApprove = async () => {
    if (!window.confirm(
      `Auto-approve all fully matched bills with total variance ≤ ${formatCurrency(maxAmount)}?\n\nThis will set those bills to "Approved" status. This action cannot be undone.`
    )) return;
    setApproving(true);
    setApproveResult(null);
    try {
      const result: { approvedCount: number; billIds: string[] } = await api.vnAutoApproveMatched(maxAmount);
      setApproveResult({ approvedCount: result.approvedCount });
      setReloadKey(k => k + 1);
    } catch {
      // silently fail — user can retry
    } finally {
      setApproving(false);
    }
  };

  const handleLinked = () => {
    setReloadKey(k => k + 1);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* KPI strip */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <StatCard
          label="Matched Bills"
          value={kpiLoading ? '…' : kpi.matchedCount}
          sub="Clean 3-way matches"
          color={TOK.income}
        />
        <StatCard
          label="Exceptions"
          value={kpiLoading ? '…' : kpi.exceptionsCount}
          sub="Need review"
          color={kpi.exceptionsCount > 0 ? TOK.expense : TOK.muted}
        />
        <StatCard
          label="Unmatched Bills"
          value={kpiLoading ? '…' : kpi.unmatchedCount}
          sub="No PO linked"
          color={kpi.unmatchedCount > 0 ? TOK.warning : TOK.muted}
        />
        <StatCard
          label="Total Variance"
          value={kpiLoading ? '…' : formatCurrency(kpi.totalVariance)}
          sub="Across matched bills"
          color={kpi.totalVariance !== 0 ? TOK.expense : TOK.income}
        />
      </div>

      {/* Unmatched Bills */}
      <Section
        title="Unmatched Bills"
        icon={<Link2 size={12} style={{ color: TOK.warning }} />}
        count={kpi.unmatchedCount}
        right={
          <span style={{ fontSize: 10, color: TOK.muted }}>
            Click "Link PO" to create a 3-way match
          </span>
        }
      >
        <UnmatchedBillsSection key={reloadKey} onLinked={handleLinked} />
      </Section>

      {/* Match Exceptions */}
      <Section
        title="Match Exceptions"
        icon={<AlertTriangle size={12} style={{ color: TOK.expense }} />}
        count={kpi.exceptionsCount}
        right={
          <span style={{ fontSize: 10, color: TOK.muted }}>
            Click a row to expand line detail
          </span>
        }
      >
        <ExceptionsSection key={reloadKey} />
      </Section>

      {/* Touchless Auto-Approve */}
      <Section
        title="Touchless Auto-Approve"
        icon={<Zap size={12} style={{ color: TOK.brand }} />}
      >
        <div className="px-4 py-3 flex flex-col gap-3">
          <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
            Automatically approve all clean-matched bills (zero exceptions, all lines matched) where
            the total variance is at or below the threshold. Bills will be set to <strong>Approved</strong> status.
          </p>
          <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
            <label style={{ fontSize: 11, color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>Max variance threshold ($)</span>
              <input
                type="number"
                min={0}
                step={50}
                value={maxAmount}
                onChange={e => setMaxAmount(Math.max(0, Number(e.target.value)))}
                className="block-input"
                style={{ width: 90, fontSize: 11, padding: '3px 8px' }}
              />
            </label>
            <button
              onClick={handleAutoApprove}
              disabled={approving}
              className="block-btn"
              style={{
                fontSize: 11,
                padding: '4px 14px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                opacity: approving ? 0.6 : 1,
              }}
            >
              <CheckCircle2 size={12} />
              {approving ? 'Approving…' : `Auto-approve clean matches ≤ ${formatCurrency(maxAmount)}`}
            </button>
          </div>
          {approveResult !== null && (
            <div style={{
              fontSize: 11,
              color: TOK.income,
              background: `color-mix(in srgb, ${TOK.income} 10%, transparent)`,
              border: `1px solid color-mix(in srgb, ${TOK.income} 30%, transparent)`,
              borderRadius: 6,
              padding: '6px 12px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}>
              <CheckCircle2 size={12} />
              {approveResult.approvedCount === 0
                ? 'No eligible bills found to approve at this threshold.'
                : `${approveResult.approvedCount} bill${approveResult.approvedCount !== 1 ? 's' : ''} approved successfully.`}
            </div>
          )}
        </div>
      </Section>
    </div>
  );
};

export default Matching;
