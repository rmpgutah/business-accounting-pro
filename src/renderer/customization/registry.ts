// src/renderer/customization/registry.ts
//
// AUTO-GENERATED aggregation of all per-section customization descriptors.
// Each ./sections/<id>.ts exports `customizations: CustomizationOption[]`.

import { CustomizationOption, SectionCustomizations } from './types';

import { customizations as dashboard } from './sections/dashboard';
import { customizations as accounts } from './sections/accounts';
import { customizations as invoicing } from './sections/invoicing';
import { customizations as expenses } from './sections/expenses';
import { customizations as clients } from './sections/clients';
import { customizations as payroll } from './sections/payroll';
import { customizations as timeTracking } from './sections/time-tracking';
import { customizations as projects } from './sections/projects';
import { customizations as inventory } from './sections/inventory';
import { customizations as taxes } from './sections/taxes';
import { customizations as budgets } from './sections/budgets';
import { customizations as bankRecon } from './sections/bank-recon';
import { customizations as reports } from './sections/reports';
import { customizations as recurring } from './sections/recurring';
import { customizations as loans } from './sections/loans';
import { customizations as bills } from './sections/bills';
import { customizations as purchaseOrders } from './sections/purchase-orders';
import { customizations as fixedAssets } from './sections/fixed-assets';
import { customizations as debtCollection } from './sections/debt-collection';
import { customizations as quotes } from './sections/quotes';

export const SECTIONS: SectionCustomizations[] = [
  { section: 'dashboard', label: 'Dashboard', options: dashboard },
  { section: 'accounts', label: 'Accounts & General Ledger', options: accounts },
  { section: 'invoicing', label: 'Invoicing', options: invoicing },
  { section: 'expenses', label: 'Expenses', options: expenses },
  { section: 'clients', label: 'Clients', options: clients },
  { section: 'payroll', label: 'Employees & Payroll', options: payroll },
  { section: 'time-tracking', label: 'Time Tracking', options: timeTracking },
  { section: 'projects', label: 'Projects', options: projects },
  { section: 'inventory', label: 'Inventory', options: inventory },
  { section: 'taxes', label: 'Taxes', options: taxes },
  { section: 'budgets', label: 'Budgets', options: budgets },
  { section: 'bank-recon', label: 'Bank Reconciliation', options: bankRecon },
  { section: 'reports', label: 'Reports', options: reports },
  { section: 'recurring', label: 'Recurring Transactions', options: recurring },
  { section: 'loans', label: 'Loans & Debt', options: loans },
  { section: 'bills', label: 'Bills & Accounts Payable', options: bills },
  { section: 'purchase-orders', label: 'Purchase Orders', options: purchaseOrders },
  { section: 'fixed-assets', label: 'Fixed Assets', options: fixedAssets },
  { section: 'debt-collection', label: 'Debt Collection', options: debtCollection },
  { section: 'quotes', label: 'Quotes & Estimates', options: quotes },
];

/** Flat list of every customization option across all sections. */
export const ALL_OPTIONS: CustomizationOption[] = SECTIONS.flatMap((s) => s.options);

/** Total number of customization options. */
export const TOTAL_OPTIONS = ALL_OPTIONS.length;

/** Storage key for a given option's value. */
export function optionKey(section: string, id: string): string {
  return `${section}.${id}`;
}

/** Map of key -> default value, used to seed the preferences store. */
export function defaultsMap(): Record<string, boolean | string | number> {
  const out: Record<string, boolean | string | number> = {};
  for (const opt of ALL_OPTIONS) out[optionKey(opt.section, opt.id)] = opt.default;
  return out;
}
