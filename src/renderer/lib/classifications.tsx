// src/renderer/lib/classifications.tsx
//
// Per-entity classification systems — tiers, segments, phases, priorities.
// Each classification dimension has options with a color (CSS) and optional
// icon. Renders as ClassificationBadge in list rows and ClassificationSelect
// in forms.
//
// Sorting rule (app-wide): all dropdowns are alphabetically sorted at render
// time. The ordering of the OPTIONS array below is irrelevant to UI order.

import React from 'react';

export interface ClassificationOption {
  value: string;
  label: string;
  /** Foreground color used by badge text + icon */
  color: string;
  /** Soft background tint (rgba) for badge */
  bg: string;
  /** Optional unicode icon prefix */
  icon?: string;
}

export interface ClassificationDef {
  options: ClassificationOption[];
  /** Optional optgroup map {label → values[]} for natural grouping */
  groups?: { label: string; values: string[] }[];
}

// ─── Color palette (consistent with app theme) ──────────
const C = {
  bronze:    { color: '#a16207', bg: 'rgba(161,98,7,0.14)' },
  silver:    { color: '#94a3b8', bg: 'rgba(148,163,184,0.14)' },
  gold:      { color: '#eab308', bg: 'rgba(234,179,8,0.14)' },
  platinum:  { color: '#e0e7ff', bg: 'rgba(224,231,255,0.14)' },
  blue:      { color: '#3b82f6', bg: 'rgba(59,130,246,0.14)' },
  green:     { color: '#22c55e', bg: 'rgba(34,197,94,0.14)' },
  amber:     { color: '#f59e0b', bg: 'rgba(245,158,11,0.14)' },
  red:       { color: '#ef4444', bg: 'rgba(239,68,68,0.14)' },
  purple:    { color: '#a855f7', bg: 'rgba(168,85,247,0.14)' },
  teal:      { color: '#14b8a6', bg: 'rgba(20,184,166,0.14)' },
  pink:      { color: '#ec4899', bg: 'rgba(236,72,153,0.14)' },
  slate:     { color: '#94a3b8', bg: 'rgba(148,163,184,0.10)' },
  indigo:    { color: '#6366f1', bg: 'rgba(99,102,241,0.14)' },
  orange:    { color: '#f97316', bg: 'rgba(249,115,22,0.14)' },
  cyan:      { color: '#06b6d4', bg: 'rgba(6,182,212,0.14)' },
};

const opt = (
  value: string,
  label: string,
  c: { color: string; bg: string },
  icon?: string,
): ClassificationOption => ({ value, label, color: c.color, bg: c.bg, icon });

// ─── 1. Client tier ────────────────────────────────────
export const CLIENT_TIER: ClassificationDef = {
  options: [
    opt('bronze',   'Bronze',   C.bronze,   '●'),
    opt('silver',   'Silver',   C.silver,   '●'),
    opt('gold',     'Gold',     C.gold,     '●'),
    opt('platinum', 'Platinum', C.platinum, '●'),
  ],
};

// ─── 2. Client industry ───────────────────────────────
export const CLIENT_INDUSTRY: ClassificationDef = {
  options: [
    opt('construction',  'Construction',  C.amber,  '🏗'),
    opt('healthcare',    'Healthcare',    C.red,    '⚕'),
    opt('legal',         'Legal',         C.indigo, '⚖'),
    opt('manufacturing', 'Manufacturing', C.slate,  '⚙'),
    opt('nonprofit',     'Nonprofit',     C.pink,   '♥'),
    opt('other',         'Other',         C.slate),
    opt('real_estate',   'Real Estate',   C.teal,   '🏠'),
    opt('retail',        'Retail',        C.orange, '🛍'),
    opt('service',       'Service',       C.blue,   '🛠'),
    opt('tech',          'Tech',          C.purple, '💻'),
  ],
};

// ─── 3. Client segment ────────────────────────────────
export const CLIENT_SEGMENT: ClassificationDef = {
  options: [
    opt('smb',         'SMB',         C.blue),
    opt('mid_market',  'Mid-Market',  C.purple),
    opt('enterprise',  'Enterprise',  C.gold),
  ],
};

// ─── 4. Client lifecycle stage ────────────────────────
export const CLIENT_LIFECYCLE: ClassificationDef = {
  options: [
    opt('lead',     'Lead',     C.blue),
    opt('active',   'Active',   C.green),
    opt('inactive', 'Inactive', C.slate),
    opt('lost',     'Lost',     C.red),
    opt('vip',      'VIP',      C.gold, '★'),
  ],
};

// ─── 5. Client risk rating ────────────────────────────
export const CLIENT_RISK: ClassificationDef = {
  options: [
    opt('low',      'Low',      C.green),
    opt('medium',   'Medium',   C.amber),
    opt('high',     'High',     C.orange),
    opt('critical', 'Critical', C.red, '▲'),
  ],
};

// ─── 6. Vendor type ───────────────────────────────────
export const VENDOR_TYPE: ClassificationDef = {
  options: [
    opt('contractor',   'Contractor',   C.amber),
    opt('government',   'Government',   C.indigo),
    opt('service',      'Service',      C.blue),
    opt('subscription', 'Subscription', C.purple),
    opt('supplier',     'Supplier',     C.green),
    opt('utility',      'Utility',      C.cyan),
  ],
};

// ─── 7. Vendor approval status ────────────────────────
export const VENDOR_APPROVAL: ClassificationDef = {
  options: [
    opt('approved',    'Approved',    C.green),
    opt('blocked',     'Blocked',     C.red, '⛔'),
    opt('conditional', 'Conditional', C.amber),
    opt('preferred',   'Preferred',   C.gold, '★'),
  ],
};

// ─── 8. Vendor 1099 box ───────────────────────────────
export const VENDOR_1099_BOX: ClassificationDef = {
  options: [
    opt('box1', 'Box 1 — Rents',        C.blue),
    opt('box3', 'Box 3 — Other Income', C.purple),
    opt('box6', 'Box 6 — Medical',      C.red),
    opt('box7', 'Box 7 — NEC',          C.amber),
  ],
};

// ─── 9. Vendor diversity (multi-select) ───────────────
export const VENDOR_DIVERSITY: ClassificationDef = {
  options: [
    opt('minority_owned', 'Minority-Owned', C.purple),
    opt('small_business', 'Small Business', C.blue),
    opt('veteran_owned',  'Veteran-Owned',  C.green),
    opt('women_owned',    'Women-Owned',    C.pink),
  ],
};

// ─── 10. Vendor location type ─────────────────────────
export const VENDOR_LOCATION: ClassificationDef = {
  options: [
    opt('domestic',      'Domestic',      C.blue),
    opt('international', 'International', C.purple),
    opt('local',         'Local',         C.green),
  ],
};

// ─── 11. Project phase ────────────────────────────────
export const PROJECT_PHASE: ClassificationDef = {
  options: [
    opt('discovery', 'Discovery', C.blue,   '①'),
    opt('planning',  'Planning',  C.purple, '②'),
    opt('execution', 'Execution', C.amber,  '③'),
    opt('review',    'Review',    C.cyan,   '④'),
    opt('complete',  'Complete',  C.green,  '✓'),
  ],
};
export const PROJECT_PHASE_ORDER = ['discovery', 'planning', 'execution', 'review', 'complete'];

// ─── 12. Project methodology ──────────────────────────
export const PROJECT_METHODOLOGY: ClassificationDef = {
  options: [
    opt('agile',                'Agile',                C.green),
    opt('hybrid',               'Hybrid',               C.purple),
    opt('time_and_materials',   'Time-and-Materials',   C.amber),
    opt('waterfall',            'Waterfall',            C.blue),
  ],
};

// ─── 13. Project type ─────────────────────────────────
export const PROJECT_TYPE: ClassificationDef = {
  options: [
    opt('client',       'Client',         C.blue),
    opt('internal',     'Internal',       C.slate),
    opt('internal_rd',  'Internal R&D',   C.purple),
    opt('pro_bono',     'Pro Bono',       C.green),
  ],
};

// ─── 14. Project priority ─────────────────────────────
export const PROJECT_PRIORITY: ClassificationDef = {
  options: [
    opt('low',      'Low',      C.slate),
    opt('medium',   'Medium',   C.blue),
    opt('high',     'High',     C.amber),
    opt('critical', 'Critical', C.red, '▲'),
  ],
};

// ─── 15. Project health ───────────────────────────────
export const PROJECT_HEALTH: ClassificationDef = {
  options: [
    opt('on_track',  'On Track',  C.green,  '●'),
    opt('at_risk',   'At Risk',   C.amber,  '◐'),
    opt('off_track', 'Off Track', C.red,    '○'),
  ],
};

// ─── 16. Debt priority (icon-coded) ───────────────────
export const DEBT_PRIORITY: ClassificationDef = {
  options: [
    opt('low',      'Low',      C.slate, '▽'),
    opt('medium',   'Medium',   C.blue,  '◆'),
    opt('high',     'High',     C.amber, '▲▲'),
    opt('critical', 'Critical', C.red,   '▲▲▲'),
  ],
};

// ─── 17. Debt risk category ───────────────────────────
export const DEBT_RISK: ClassificationDef = {
  options: [
    opt('low',      'Low',      C.green),
    opt('medium',   'Medium',   C.amber),
    opt('high',     'High',     C.orange),
    opt('critical', 'Critical', C.red),
  ],
};

// ─── 18. Debt segment ────────────────────────────────
export const DEBT_SEGMENT: ClassificationDef = {
  options: [
    opt('commercial', 'Commercial', C.blue),
    opt('consumer',   'Consumer',   C.green),
    opt('government', 'Government', C.indigo),
    opt('insurance',  'Insurance',  C.purple),
  ],
};

// ─── 19. Debt origination type ────────────────────────
export const DEBT_ORIGINATION: ClassificationDef = {
  options: [
    opt('contract',        'Contract',        C.blue),
    opt('court_judgment',  'Court Judgment',  C.red),
    opt('open_account',    'Open Account',    C.amber),
    opt('other',           'Other',           C.slate),
    opt('promissory_note', 'Promissory Note', C.purple),
  ],
};

// ─── 20. Debt collectability ──────────────────────────
export const DEBT_COLLECTABILITY: ClassificationDef = {
  options: [
    opt('highly_collectable', 'Highly Collectable', C.green),
    opt('likely',             'Likely',             C.blue),
    opt('marginal',           'Marginal',           C.amber),
    opt('uncollectable',      'Uncollectable',      C.red),
  ],
};

// ─── 21. Employee role ────────────────────────────────
export const EMPLOYEE_ROLE: ClassificationDef = {
  options: [
    opt('contractor', 'Contractor', C.amber),
    opt('intern',     'Intern',     C.cyan),
    opt('junior',     'Junior',     C.blue),
    opt('manager',    'Manager',    C.purple),
    opt('mid',        'Mid',        C.teal),
    opt('owner',      'Owner',      C.gold, '★'),
    opt('senior',     'Senior',     C.green),
  ],
};

// ─── 22. Employee department (curated default list; admin-extensible)
export const EMPLOYEE_DEPARTMENT: ClassificationDef = {
  options: [
    opt('accounting',     'Accounting',     C.blue),
    opt('admin',          'Admin',          C.slate),
    opt('customer_svc',   'Customer Service', C.cyan),
    opt('engineering',    'Engineering',    C.purple),
    opt('finance',        'Finance',        C.green),
    opt('hr',             'Human Resources', C.pink),
    opt('it',             'IT',             C.indigo),
    opt('legal',          'Legal',          C.amber),
    opt('marketing',      'Marketing',      C.orange),
    opt('operations',     'Operations',     C.teal),
    opt('sales',          'Sales',          C.red),
  ],
};

// ─── 23. Employee work location ───────────────────────
export const EMPLOYEE_WORK_LOCATION: ClassificationDef = {
  options: [
    opt('hybrid',  'Hybrid',  C.purple),
    opt('on_site', 'On-site', C.amber),
    opt('remote',  'Remote',  C.green),
  ],
};

// ─── 24. Employment status (extended) ─────────────────
export const EMPLOYMENT_STATUS: ClassificationDef = {
  options: [
    opt('active',     'Active',     C.green),
    opt('inactive',   'Inactive',   C.slate),
    opt('on_leave',   'On Leave',   C.amber),
    opt('probation',  'Probation',  C.cyan),
    opt('terminated', 'Terminated', C.red),
  ],
};

// ─── 25. Employee labor cost classification ───────────
export const EMPLOYEE_COST_CLASS: ClassificationDef = {
  options: [
    opt('direct',    'Direct',    C.green),
    opt('indirect',  'Indirect',  C.blue),
    opt('marketing', 'Marketing', C.orange),
    opt('overhead',  'Overhead',  C.amber),
  ],
};

// ─── 26. Fixed asset category ─────────────────────────
export const ASSET_CATEGORY: ClassificationDef = {
  options: [
    opt('building',  'Building',  C.indigo, '🏢'),
    opt('equipment', 'Equipment', C.amber,  '⚙'),
    opt('furniture', 'Furniture', C.purple, '🪑'),
    opt('land',      'Land',      C.green,  '◯'),
    opt('software',  'Software',  C.blue,   '💻'),
    opt('vehicle',   'Vehicle',   C.red,    '🚗'),
  ],
};

// ─── 27. Asset condition ──────────────────────────────
export const ASSET_CONDITION: ClassificationDef = {
  options: [
    opt('disposed', 'Disposed', C.slate),
    opt('fair',     'Fair',     C.amber),
    opt('good',     'Good',     C.blue),
    opt('new',      'New',      C.green),
    opt('poor',     'Poor',     C.red),
  ],
};

// ─── 28. Inventory category ───────────────────────────
export const INVENTORY_CATEGORY: ClassificationDef = {
  options: [
    opt('finished_goods', 'Finished Goods', C.green),
    opt('raw_material',   'Raw Material',   C.amber),
    opt('supplies',       'Supplies',       C.cyan),
    opt('wip',            'WIP',            C.purple),
  ],
};

// ─── 29. Account business purpose ─────────────────────
export const ACCOUNT_PURPOSE: ClassificationDef = {
  options: [
    opt('compliance', 'Compliance', C.amber),
    opt('investment', 'Investment', C.purple),
    opt('operating',  'Operating',  C.green),
    opt('other',      'Other',      C.slate),
    opt('tax',        'Tax',        C.red),
  ],
};

// ─── 30. Account criticality ──────────────────────────
export const ACCOUNT_CRITICALITY: ClassificationDef = {
  options: [
    opt('important',         'Important',         C.amber),
    opt('mission_critical',  'Mission-Critical',  C.red, '▲'),
    opt('standard',          'Standard',          C.slate),
  ],
};

// ─── Sorted options (alphabetical by label) ───────────
export function sortedOptions(def: ClassificationDef): ClassificationOption[] {
  return [...def.options].sort((a, b) => a.label.localeCompare(b.label));
}

// ─── Find option ──────────────────────────────────────
export function findOption(def: ClassificationDef, value: string | null | undefined): ClassificationOption | undefined {
  if (!value) return undefined;
  return def.options.find(o => o.value === value);
}

// ─── Badge component ──────────────────────────────────
interface BadgeProps {
  def: ClassificationDef;
  value: string | null | undefined;
  /** Custom color overrides def lookup (for admin-defined colors). */
  colorOverride?: string;
  size?: 'xs' | 'sm';
  className?: string;
}

export const ClassificationBadge: React.FC<BadgeProps> = ({ def, value, colorOverride, size = 'sm', className }) => {
  if (!value) return <span className="text-text-muted text-xs">—</span>;
  const o = findOption(def, value);
  if (!o) {
    return (
      <span className="block-badge" style={{ background: 'rgba(148,163,184,0.10)', color: '#94a3b8' }}>
        {value}
      </span>
    );
  }
  const color = colorOverride || o.color;
  const fontSize = size === 'xs' ? 10 : 11;
  return (
    <span
      className={`inline-flex items-center gap-1 font-semibold tracking-wide ${className ?? ''}`}
      style={{
        color,
        background: o.bg,
        padding: '3px 8px',
        borderRadius: 4,
        fontSize,
        letterSpacing: '0.02em',
      }}
      title={o.label}
    >
      {o.icon ? <span style={{ lineHeight: 1 }}>{o.icon}</span> : null}
      <span>{o.label}</span>
    </span>
  );
};

// ─── Multi-badge (for diversity etc.) ─────────────────
export const ClassificationBadges: React.FC<{
  def: ClassificationDef;
  values: string[] | string | null | undefined;
}> = ({ def, values }) => {
  let arr: string[] = [];
  if (Array.isArray(values)) arr = values;
  else if (typeof values === 'string' && values.trim()) {
    try {
      const parsed = JSON.parse(values);
      arr = Array.isArray(parsed) ? parsed : [];
    } catch {
      arr = values.split(',').map(s => s.trim()).filter(Boolean);
    }
  }
  if (!arr.length) return <span className="text-text-muted text-xs">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {arr.map(v => <ClassificationBadge key={v} def={def} value={v} />)}
    </div>
  );
};

// ─── Select (dropdown) component ──────────────────────
interface SelectProps {
  def: ClassificationDef;
  value: string;
  onChange: (value: string) => void;
  /** Render an empty "— Select —" option at the top. */
  allowEmpty?: boolean;
  emptyLabel?: string;
  className?: string;
  id?: string;
}

export const ClassificationSelect: React.FC<SelectProps> = ({
  def, value, onChange, allowEmpty = true, emptyLabel = '— Select —', className, id,
}) => {
  const sorted = sortedOptions(def);
  return (
    <select
      id={id}
      className={className ?? 'block-select w-full'}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
    >
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {sorted.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
};

// ─── Multi-select (checkbox group, alphabetical) ──────
export const ClassificationMultiSelect: React.FC<{
  def: ClassificationDef;
  values: string[];
  onChange: (values: string[]) => void;
  className?: string;
}> = ({ def, values, onChange, className }) => {
  const sorted = sortedOptions(def);
  const toggle = (v: string) => {
    if (values.includes(v)) onChange(values.filter(x => x !== v));
    else onChange([...values, v]);
  };
  return (
    <div className={`flex flex-wrap gap-2 ${className ?? ''}`}>
      {sorted.map(o => {
        const active = values.includes(o.value);
        return (
          <button
            type="button"
            key={o.value}
            onClick={() => toggle(o.value)}
            className="inline-flex items-center gap-1 text-xs font-semibold transition-colors"
            style={{
              padding: '4px 9px',
              borderRadius: 4,
              border: `1px solid ${active ? o.color : 'rgba(255,255,255,0.10)'}`,
              background: active ? o.bg : 'transparent',
              color: active ? o.color : 'var(--color-text-muted)',
            }}
          >
            {o.icon ? <span>{o.icon}</span> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
};

// ─── Helpers for auto-classification logic ────────────
export function riskRatingFromAvgDaysLate(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return 'low';
  if (days < 15)  return 'low';
  if (days < 45)  return 'medium';
  if (days < 90)  return 'high';
  return 'critical';
}

export function riskCategoryFromScore(score: number): string {
  // risk_score is 0-100 in this app
  if (!Number.isFinite(score) || score < 25) return 'low';
  if (score < 50) return 'medium';
  if (score < 75) return 'high';
  return 'critical';
}

export function projectHealthAuto(
  budgetSpentPct: number,   // 0–1
  daysRemainingPct: number, // 0–1 (1 = lots of time left, 0 = past deadline)
): string {
  if (!Number.isFinite(budgetSpentPct)) budgetSpentPct = 0;
  if (!Number.isFinite(daysRemainingPct)) daysRemainingPct = 1;
  if (budgetSpentPct > 1.0 || daysRemainingPct < 0) return 'off_track';
  if (budgetSpentPct > 0.85 && daysRemainingPct < 0.20) return 'off_track';
  if (budgetSpentPct > 0.70 && daysRemainingPct < 0.30) return 'at_risk';
  return 'on_track';
}
