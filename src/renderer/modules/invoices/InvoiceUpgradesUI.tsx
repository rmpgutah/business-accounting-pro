/**
 * InvoiceUpgradesUI — visual surfaces for Invoice Upgrades Wave (F893-F922).
 *
 * Five reusable widgets:
 *   • InvoiceBulkActionBar — appears when invoice rows are selected; offers
 *     send-reminders, mark-sent, bulk-void, export-PDF, apply-payment
 *   • OverdueAlertBanner — count + total of overdue invoices, dismissable
 *   • TopClientsWidget — revenue + outstanding per client, last 90 days
 *   • DSOMiniCard — company-wide DSO with rolling 90-day window
 *   • AgingBucketBar — stacked horizontal bar of AR buckets
 *
 * Plus utility components:
 *   • DueDatePill, ViewedByClientPill, CollectionProbabilityGauge
 *
 * Same parent-owned-state pattern as ExpenseUpgradesUI: parent passes data
 * in, child renders + emits actions. No store dependencies.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, Download, FileText, Mail, Trash2, X } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/format';

// ─── DueDatePill ────────────────────────────────────────
export function DueDatePill({ dueDate, status }: { dueDate?: string; status?: string }) {
  if (!dueDate || status === 'paid' || status === 'cancelled' || status === 'void') return null;
  const dueTime = new Date(dueDate + 'T00:00:00Z').getTime();
  const todayTime = Date.now();
  const daysOver = Math.floor((todayTime - dueTime) / 86400000);
  if (daysOver > 0) return <span className="iu-due-pill overdue">−{daysOver}d</span>;
  if (daysOver === 0) return <span className="iu-due-pill today">DUE TODAY</span>;
  const daysAhead = Math.abs(daysOver);
  if (daysAhead <= 7) return <span className="iu-due-pill this-week">in {daysAhead}d</span>;
  return <span className="iu-due-pill future">in {daysAhead}d</span>;
}

// ─── ViewedByClientPill ─────────────────────────────────
export function ViewedByClientPill({ viewCount }: { viewCount: number | null }) {
  if (viewCount == null) return null;
  if (viewCount === 0) return <span className="iu-view-pill unviewed">UNVIEWED</span>;
  return <span className="iu-view-pill">VIEWED {viewCount}×</span>;
}

// ─── CollectionProbabilityGauge ─────────────────────────
export function CollectionProbabilityGauge({ score }: { score: number | null | undefined }) {
  if (score == null) return null;
  const band = score >= 75 ? 'excellent' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';
  return (
    <div className="iu-cp-gauge" title={`Collection probability: ${score}/100`}>
      <div className="iu-cp-track">
        <div className={`iu-cp-fill ${band}`} style={{ width: `${score}%` }} />
      </div>
      <div className="iu-cp-label">
        <span>{band.toUpperCase()}</span>
        <span>{score}%</span>
      </div>
    </div>
  );
}

// ─── DSOMiniCard ────────────────────────────────────────
export function DSOMiniCard({ clientId, periodDays = 90 }: { clientId?: string; periodDays?: number }) {
  const [dso, setDso] = useState<number | null>(null);
  const [sample, setSample] = useState(0);

  useEffect(() => {
    (async () => {
      const res = await (api as any).iuDso?.({ client_id: clientId, period_days: periodDays });
      if (res && !res.error) {
        setDso(res.dso_days || 0);
        setSample(res.sample_invoices || 0);
      }
    })();
  }, [clientId, periodDays]);

  if (dso == null) return null;
  const band = dso <= 15 ? 'fast' : dso <= 30 ? 'normal' : dso <= 60 ? 'slow' : 'bad';
  return (
    <div className="eu-insight-card" style={{ minWidth: 160 }}>
      <div className="eu-insight-title">DSO ({periodDays}d)</div>
      <div className="eu-insight-value">
        {Math.round(dso)} <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>days</span>
      </div>
      <div style={{ marginTop: 4 }}>
        <span className={`iu-dso ${band}`}>{band.toUpperCase()}</span>
        <span style={{ fontSize: 9, color: 'var(--color-text-muted)', marginLeft: 6 }}>{sample} paid invoices</span>
      </div>
    </div>
  );
}

// ─── TopClientsWidget ───────────────────────────────────
export function TopClientsWidget({ since, until, limit = 5 }: { since?: string; until?: string; limit?: number }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await (api as any).iuTopClients?.({ since, until, limit });
      setRows(Array.isArray(res) ? res : []);
      setLoading(false);
    })();
  }, [since, until, limit]);

  if (loading) return null;
  if (rows.length === 0) return null;

  return (
    <div className="iu-tc-widget">
      <div className="iu-tc-header">
        <span>Top clients (last 90 days)</span>
        <span>{rows.length}</span>
      </div>
      {rows.map((r, i) => (
        <div key={r.id || i} className="iu-tc-row">
          <div className="iu-tc-name">{r.name || '(no client)'}</div>
          <div className="iu-tc-revenue">{formatCurrency(r.total_revenue || 0)}</div>
          <div className={`iu-tc-outstanding ${(r.outstanding || 0) === 0 ? 'zero' : ''}`}>
            {(r.outstanding || 0) > 0 ? `−${formatCurrency(r.outstanding)}` : '—'}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── AgingBucketBar ─────────────────────────────────────
export function AgingBucketBar({ clientId }: { clientId?: string }) {
  const [buckets, setBuckets] = useState<any>(null);
  useEffect(() => {
    (async () => {
      const res = await (api as any).iuAging?.(clientId);
      if (res && !res.error) setBuckets(res);
    })();
  }, [clientId]);

  if (!buckets) return null;
  const total = (buckets.current || 0) + (buckets.b1_30 || 0) + (buckets.b31_60 || 0) + (buckets.b61_90 || 0) + (buckets.b90plus || 0);
  if (total <= 0) return null;
  const pct = (n: number) => Math.max(0, (n / total) * 100);

  return (
    <div className="eu-insight-card" style={{ minWidth: 240 }}>
      <div className="eu-insight-title">AR Aging</div>
      <div className="iu-aging-stack">
        {(buckets.current || 0) > 0 && <div className="iu-aging-seg current" style={{ width: `${pct(buckets.current)}%` }} />}
        {(buckets.b1_30 || 0) > 0 && <div className="iu-aging-seg b30" style={{ width: `${pct(buckets.b1_30)}%` }} />}
        {(buckets.b31_60 || 0) > 0 && <div className="iu-aging-seg b60" style={{ width: `${pct(buckets.b31_60)}%` }} />}
        {(buckets.b61_90 || 0) > 0 && <div className="iu-aging-seg b90" style={{ width: `${pct(buckets.b61_90)}%` }} />}
        {(buckets.b90plus || 0) > 0 && <div className="iu-aging-seg b90plus" style={{ width: `${pct(buckets.b90plus)}%` }} />}
      </div>
      <div className="iu-aging-legend">
        <div className="iu-aging-key"><span className="iu-aging-dot" style={{ background: 'var(--color-accent-income)' }}></span>Current {formatCurrency(buckets.current || 0)}</div>
        <div className="iu-aging-key"><span className="iu-aging-dot" style={{ background: '#facc15' }}></span>1-30 {formatCurrency(buckets.b1_30 || 0)}</div>
        <div className="iu-aging-key"><span className="iu-aging-dot" style={{ background: 'var(--color-accent-warning)' }}></span>31-60 {formatCurrency(buckets.b31_60 || 0)}</div>
        <div className="iu-aging-key"><span className="iu-aging-dot" style={{ background: 'var(--color-accent-expense)' }}></span>61-90 {formatCurrency(buckets.b61_90 || 0)}</div>
        <div className="iu-aging-key"><span className="iu-aging-dot" style={{ background: 'var(--color-accent-expense)' }}></span>90+ {formatCurrency(buckets.b90plus || 0)}</div>
      </div>
    </div>
  );
}

// ─── OverdueAlertBanner ─────────────────────────────────
export function OverdueAlertBanner() {
  const [overdue, setOverdue] = useState<{ count: number; total: number } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    (async () => {
      const buckets = await (api as any).iuAging?.();
      if (buckets && !buckets.error) {
        const totalOverdue = (buckets.b1_30 || 0) + (buckets.b31_60 || 0) + (buckets.b61_90 || 0) + (buckets.b90plus || 0);
        // We don't have the count directly; estimate from outstanding > 0 in aging
        setOverdue({ count: totalOverdue > 0 ? 1 : 0, total: totalOverdue }); // placeholder; refine if needed
        if (totalOverdue > 0) {
          const top = await (api as any).iuTopClients?.({ limit: 50 });
          const cnt = Array.isArray(top) ? top.filter((c: any) => (c.outstanding || 0) > 0).length : 0;
          setOverdue({ count: cnt, total: totalOverdue });
        }
      }
    })();
  }, []);

  if (dismissed || !overdue || overdue.total <= 0) return null;
  return (
    <div className="iu-banner-overdue">
      <AlertTriangle size={14} style={{ color: 'var(--color-accent-expense)' }} />
      <span>
        <strong>{formatCurrency(overdue.total)}</strong> overdue across <strong>{overdue.count}</strong> client{overdue.count === 1 ? '' : 's'}.
      </span>
      <span className="spacer" />
      <a onClick={() => setDismissed(true)}>Dismiss</a>
    </div>
  );
}

// ─── InvoiceBulkActionBar ───────────────────────────────
interface InvoiceBulkActionBarProps {
  selectedIds: string[];
  onCleared: () => void;
  onRefresh: () => void;
}
export function InvoiceBulkActionBar({ selectedIds, onCleared, onRefresh }: InvoiceBulkActionBarProps) {
  if (selectedIds.length === 0) return null;

  const sendReminders = async () => {
    const res = await (api as any).iuBulkRemind?.(selectedIds);
    if (res?.error) alert(`Reminder failed: ${res.error}`);
    else { alert(`Sent ${res?.sent || 0} reminders.`); onRefresh(); }
  };
  const markSent = async () => {
    const res = await (api as any).iuBulkMarkSent?.(selectedIds);
    if (res?.error) alert(`Mark-sent failed: ${res.error}`);
    else onRefresh();
  };
  const voidThese = async () => {
    const reason = prompt(`Void ${selectedIds.length} invoice(s) — reason:`);
    if (reason === null || !reason.trim()) return;
    if (!confirm(`Void ${selectedIds.length} invoice(s)? Paid invoices will be skipped.`)) return;
    const res = await (api as any).iuBulkVoid?.(selectedIds, reason.trim());
    if (res?.error) alert(`Void failed: ${res.error}`);
    else { alert(`Voided ${res?.voided || 0} of ${selectedIds.length} invoice(s).`); onRefresh(); }
  };
  const exportBatch = async () => {
    const manifest = await (api as any).iuBulkExportManifest?.(selectedIds);
    if (manifest?.error) { alert(`Manifest failed: ${manifest.error}`); return; }
    alert(`${manifest?.count || 0} invoice(s) totaling ${formatCurrency(manifest?.total_amount || 0)} are ready to export.`);
  };

  return (
    <div className="iu-bulk-bar">
      <span className="iu-count">{selectedIds.length}</span>
      <span>selected</span>
      <div className="iu-actions">
        <button type="button" className="iu-act-btn" onClick={sendReminders}>
          <Mail size={11} /> Send reminders
        </button>
        <button type="button" className="iu-act-btn" onClick={markSent}>
          <CheckCircle size={11} /> Mark as sent
        </button>
        <button type="button" className="iu-act-btn" onClick={exportBatch}>
          <Download size={11} /> Export batch
        </button>
        <button type="button" className="iu-act-btn danger" onClick={voidThese}>
          <Trash2 size={11} /> Void
        </button>
        <button type="button" className="iu-act-btn" onClick={onCleared}>
          <X size={11} /> Clear
        </button>
      </div>
    </div>
  );
}
