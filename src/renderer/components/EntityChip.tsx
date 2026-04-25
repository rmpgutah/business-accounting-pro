// src/renderer/components/EntityChip.tsx
//
// Inline clickable badge that turns any foreign-key reference into a
// navigable link. Drop in wherever a table cell shows a client_id,
// project_id, vendor_id, invoice_number, etc.
//
//   <EntityChip type="client"  id={inv.client_id} label={client.name} />
//   <EntityChip type="invoice" id={pay.invoice_id} label={`#${inv.invoice_number}`} />
//
// Click → routes to the owning module + sets focusEntity so the target
// module auto-opens the record.

import React from 'react';
import { ExternalLink } from 'lucide-react';
import { useAppStore } from '../stores/appStore';

const MODULE_FOR: Record<string, string> = {
  invoice: 'invoicing',
  quote: 'quotes',
  client: 'clients',
  project: 'projects',
  debt: 'debt-collection',
  expense: 'expenses',
  bill: 'bills',
  purchase_order: 'purchase-orders',
  vendor: 'expenses',
  payment: 'invoicing',
  bill_payment: 'bills',
  employee: 'payroll',
  pay_stub: 'payroll',
  payroll_run: 'payroll',
  time_entry: 'time-tracking',
  budget: 'budgets',
  account: 'accounts',
  journal_entry: 'accounts',
  fixed_asset: 'fixed-assets',
  bank_account: 'bank-recon',
  bank_transaction: 'bank-recon',
  stripe_object: 'stripe-sync',
};

interface Props {
  type: string;
  id: string | null | undefined;
  label?: string;
  /** Suppress the external-link icon. */
  bare?: boolean;
  /** Visual variant. */
  variant?: 'badge' | 'inline' | 'mono';
  /** Override className entirely. */
  className?: string;
}

const EntityChip: React.FC<Props> = ({ type, id, label, bare, variant = 'badge', className }) => {
  const setModule = useAppStore((s) => s.setModule);
  const setFocusEntity = useAppStore((s) => s.setFocusEntity);

  // Nothing to link to — render as plain dim text so callers don't have
  // to special-case missing FKs at the call site.
  if (!id) {
    return <span className="text-text-muted italic text-xs">—</span>;
  }

  const display = label || `${type} ${id.slice(0, 8)}`;
  const moduleId = MODULE_FOR[type];
  const isClickable = !!moduleId;

  const handleClick = (e: React.MouseEvent) => {
    if (!isClickable) return;
    e.preventDefault();
    e.stopPropagation();
    setFocusEntity({ type, id });
    setModule(moduleId);
  };

  const baseStyle = variant === 'mono'
    ? 'font-mono text-[11px] text-text-secondary'
    : variant === 'inline'
      ? 'text-xs text-accent-blue underline-offset-2 hover:underline'
      : 'inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium bg-accent-blue/10 text-accent-blue';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!isClickable}
      title={isClickable ? `Open ${type}` : type}
      className={className ?? `${baseStyle} ${isClickable ? 'cursor-pointer hover:bg-accent-blue/20' : 'cursor-default'} transition-colors`}
      style={{ borderRadius: 2 }}
    >
      <span className="truncate">{display}</span>
      {isClickable && !bare && variant === 'badge' && <ExternalLink size={10} className="shrink-0 opacity-70" />}
    </button>
  );
};

export default EntityChip;
