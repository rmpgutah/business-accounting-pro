// src/renderer/components/RelatedPanel.tsx
//
// Drop-in panel that shows every record in the system related to a given
// entity. Used on detail pages (invoice, client, project, debt, vendor,
// employee, etc.) so the user can jump laterally through the data graph.
//
// Usage:
//   <RelatedPanel entityType="invoice" entityId={invoice.id} />
//
// Clicking an entity row routes via the app's module switcher + a focus
// payload in appStore so the target module opens at the right record.

import React, { useEffect, useMemo, useState } from 'react';
import { Link2, ChevronRight } from 'lucide-react';
import api from '../lib/api';
import { useCompanyStore } from '../stores/companyStore';
import { useAppStore } from '../stores/appStore';
import { formatCurrency } from '../lib/format';

interface Group {
  key: string;
  label: string;
  entityType: string;
  rows: Array<Record<string, unknown>>;
  total?: number;
}

interface Props {
  entityType: string;
  entityId: string;
  /** Narrow the panel to a known subset of groups (by key). Optional. */
  only?: string[];
  /** Hide groups whose key matches. */
  hide?: string[];
  /** Render compact variant (smaller padding, no header). */
  compact?: boolean;
}

// Maps an entity type to the sidebar module id that owns it, so clicking
// a row can navigate. Unknown types just toast the id to clipboard.
const MODULE_FOR: Record<string, string> = {
  invoice: 'invoicing',
  quote: 'quotes',
  client: 'clients',
  project: 'projects',
  debt: 'debt-collection',
  expense: 'expenses',
  bill: 'bills',
  purchase_order: 'purchase-orders',
  vendor: 'expenses', // vendors live inside expenses module
  payment: 'invoicing',
  bill_payment: 'bills',
  employee: 'payroll',
  pay_stub: 'payroll',
  time_entry: 'time-tracking',
  budget: 'budgets',
  account: 'accounts',
  journal_entry: 'accounts',
  fixed_asset: 'fixed-assets',
  bank_account: 'bank-recon',
  stripe_object: 'stripe-sync',
};

function inferTitle(entityType: string, row: Record<string, unknown>): string {
  // Best-effort: pick the most human field.
  const r = row as any;
  return (
    r.invoice_number ||
    r.quote_number ||
    r.bill_number ||
    r.po_number ||
    r.debt_number ||
    r.name ||
    r.description ||
    r.subject ||
    r.filename ||
    r.stripe_id ||
    r.id ||
    '(untitled)'
  );
}

function inferSubtitle(entityType: string, row: Record<string, unknown>): string {
  const r = row as any;
  const bits: string[] = [];
  if (r.status) bits.push(String(r.status));
  if (r.issue_date || r.date || r.pay_date || r.occurred_at) bits.push(String(r.issue_date || r.date || r.pay_date || r.occurred_at));
  if (typeof r.total === 'number') bits.push(formatCurrency(r.total));
  else if (typeof r.amount === 'number') bits.push(formatCurrency(r.amount));
  else if (typeof r.net_pay === 'number') bits.push(formatCurrency(r.net_pay));
  return bits.join(' · ');
}

const RelatedPanel: React.FC<Props> = ({ entityType, entityId, only, hide, compact }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const setModule = useAppStore((s) => s.setModule);
  const setFocusEntity = useAppStore((s) => s.setFocusEntity);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany?.id || !entityId) { setGroups([]); return; }
      setLoading(true);
      try {
        const result = await api.entity.graph(activeCompany.id, entityType, entityId);
        if (!cancelled) setGroups(result);
      } catch {
        if (!cancelled) setGroups([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeCompany?.id, entityType, entityId]);

  const visible = useMemo(() =>
    groups.filter((g) => (!only || only.includes(g.key)) && (!hide || !hide.includes(g.key))),
  [groups, only, hide]);

  const handleNavigate = (row: Record<string, unknown>, targetType: string) => {
    const modId = MODULE_FOR[targetType];
    if (!modId) return;
    // Push a focus hint to the app store so the target module can auto-open
    // the correct record. Each module reads appStore.focusEntity on mount.
    const rid = (row as any).id ?? (row as any).stripe_id;
    if (rid) setFocusEntity({ type: targetType, id: String(rid) });
    setModule(modId);
  };

  if (!activeCompany || !entityId) return null;

  return (
    <div className={compact ? 'space-y-2' : 'block-card p-4 space-y-3'} style={{ borderRadius: compact ? 0 : 2 }}>
      {!compact && (
        <div className="flex items-center gap-2 pb-2 border-b border-border-primary">
          <Link2 size={14} className="text-accent-blue" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary">Related</h3>
          {loading && <span className="text-[10px] text-text-muted ml-auto font-mono">Loading…</span>}
        </div>
      )}

      {visible.length === 0 && !loading && (
        <p className="text-xs text-text-muted italic">No linked records yet.</p>
      )}

      {visible.map((g) => (
        <div key={g.key}>
          <div className="flex items-center justify-between mb-1.5">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">{g.label}</h4>
            {typeof g.total === 'number' && (
              <span className="text-[11px] font-mono text-text-primary">{formatCurrency(g.total)}</span>
            )}
          </div>
          <ul className="space-y-0.5">
            {g.rows.slice(0, 10).map((row, idx) => {
              const isClickable = !!MODULE_FOR[g.entityType];
              return (
                <li
                  key={(row as any).id ?? idx}
                  className={`flex items-center justify-between gap-2 py-1 px-2 text-xs rounded-sm transition-colors ${
                    isClickable ? 'cursor-pointer hover:bg-bg-hover' : ''
                  }`}
                  onClick={() => isClickable && handleNavigate(row, g.entityType)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-text-primary truncate">{inferTitle(g.entityType, row)}</div>
                    <div className="text-[10px] text-text-muted truncate">{inferSubtitle(g.entityType, row)}</div>
                  </div>
                  {isClickable && <ChevronRight size={12} className="text-text-muted shrink-0" />}
                </li>
              );
            })}
            {g.rows.length > 10 && (
              <li className="text-[10px] text-text-muted italic pl-2">+ {g.rows.length - 10} more</li>
            )}
          </ul>
        </div>
      ))}
    </div>
  );
};

export default RelatedPanel;
