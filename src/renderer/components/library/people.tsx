import React from 'react';
import {
  Mail,
  Phone,
  Building2,
  MapPin,
  User,
  MoreHorizontal,
  type LucideIcon,
} from 'lucide-react';

/**
 * People-oriented presentational primitives for the glass/block theme.
 *
 * Every component renders correctly with ZERO props (sensible mock
 * defaults). Pure presentational — only 'react' + 'lucide-react' imports,
 * no app imports, no data fetching.
 */

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const ACCENTS = [
  'var(--color-accent-blue, #60a5fa)',
  'var(--color-accent-income, #34d399)',
  'var(--color-accent-purple, #c084fc)',
  'var(--color-accent-warning, #fbbf24)',
  'var(--color-accent-expense, #f87171)',
];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}

/* ------------------------------------------------------------------ */
/* Avatar — shared internal circle                                     */
/* ------------------------------------------------------------------ */

function Avatar({
  name,
  size = 36,
  src,
  color,
}: {
  name: string;
  size?: number;
  src?: string;
  color?: string;
}) {
  const accent = color ?? colorFor(name);
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        style={{
          width: size,
          height: size,
          borderRadius: '9999px',
          objectFit: 'cover',
          border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        }}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: '9999px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.max(10, size * 0.38),
        fontWeight: 600,
        color: accent,
        background: 'color-mix(in srgb, currentColor 16%, transparent)',
        backgroundColor: 'var(--color-bg-tertiary, rgba(28,30,38,0.65))',
        border: `1px solid ${accent}`,
        boxShadow: 'inset 0 0 0 9999px color-mix(in srgb, ' + accent + ' 12%, transparent)',
        flexShrink: 0,
        lineHeight: 1,
      }}
    >
      {initialsOf(name)}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* AvatarChip — avatar + name chip                                     */
/* ------------------------------------------------------------------ */

export interface AvatarChipProps {
  name?: string;
  subtitle?: string;
  src?: string;
  size?: number;
  /** Override the accent color. */
  color?: string;
  className?: string;
  onClick?: () => void;
}

export function AvatarChip({
  name = 'Jordan Avery',
  subtitle,
  src,
  size = 28,
  color,
  className = '',
  onClick,
}: AvatarChipProps) {
  return (
    <div
      className={className}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 10px 4px 4px',
        borderRadius: '9999px',
        backgroundColor: 'var(--color-bg-tertiary, rgba(28,30,38,0.65))',
        border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        cursor: onClick ? 'pointer' : 'default',
        maxWidth: '100%',
      }}
    >
      <Avatar name={name} src={src} size={size} color={color} />
      <div style={{ minWidth: 0, lineHeight: 1.2 }}>
        <div className="text-text-primary truncate" style={{ fontSize: 13, fontWeight: 500 }}>
          {name}
        </div>
        {subtitle && (
          <div className="text-text-muted truncate" style={{ fontSize: 11 }}>
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* AvatarStack — overlapping avatars                                   */
/* ------------------------------------------------------------------ */

export interface AvatarStackProps {
  names?: string[];
  /** Avatars to show before collapsing into a "+N" badge. */
  max?: number;
  size?: number;
  className?: string;
}

export function AvatarStack({
  names = ['Jordan Avery', 'Sam Lee', 'Priya Nair', 'Diego Cruz', 'Mei Chen'],
  max = 4,
  size = 32,
  className = '',
}: AvatarStackProps) {
  const shown = names.slice(0, max);
  const extra = Math.max(0, names.length - shown.length);
  const overlap = Math.round(size * 0.32);

  return (
    <div className={className} style={{ display: 'inline-flex', alignItems: 'center' }}>
      {shown.map((n, i) => (
        <div
          key={n + i}
          title={n}
          style={{
            marginLeft: i === 0 ? 0 : -overlap,
            borderRadius: '9999px',
            border: '2px solid var(--color-bg-secondary-solid, #121318)',
            zIndex: shown.length - i,
            position: 'relative',
          }}
        >
          <Avatar name={n} size={size} />
        </div>
      ))}
      {extra > 0 && (
        <div
          title={`${extra} more`}
          style={{
            marginLeft: -overlap,
            width: size,
            height: size,
            borderRadius: '9999px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: Math.max(10, size * 0.34),
            fontWeight: 600,
            color: 'var(--color-text-secondary, #9a9db0)',
            backgroundColor: 'var(--color-bg-tertiary, rgba(28,30,38,0.65))',
            border: '2px solid var(--color-bg-secondary-solid, #121318)',
            position: 'relative',
            zIndex: 0,
          }}
        >
          +{extra}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* shared meta row                                                     */
/* ------------------------------------------------------------------ */

function MetaRow({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div
      className="text-text-secondary"
      style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, minWidth: 0 }}
    >
      <Icon size={13} style={{ color: 'var(--color-text-muted, #5e6178)', flexShrink: 0 }} />
      <span className="truncate">{text}</span>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{ fontSize: 15, fontWeight: 600, color: accent ?? 'var(--color-text-primary, #e8eaf0)' }}
        className="truncate"
      >
        {value}
      </div>
      <div className="text-text-muted truncate" style={{ fontSize: 11 }}>
        {label}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ClientCard — client summary card                                    */
/* ------------------------------------------------------------------ */

export interface ClientCardProps {
  name?: string;
  company?: string;
  email?: string;
  phone?: string;
  /** e.g. "Active", "Overdue", "Prospect". */
  status?: string;
  /** Lifetime / outstanding balance, pre-formatted. */
  balance?: string;
  invoices?: number;
  src?: string;
  className?: string;
}

export function ClientCard({
  name = 'Acme Retail Group',
  company,
  email = 'ap@acmeretail.com',
  phone = '(415) 555-0182',
  status = 'Active',
  balance = '$12,480.00',
  invoices = 8,
  src,
  className = '',
}: ClientCardProps) {
  const statusAccent =
    status.toLowerCase() === 'overdue'
      ? 'var(--color-accent-expense, #f87171)'
      : status.toLowerCase() === 'prospect'
        ? 'var(--color-accent-warning, #fbbf24)'
        : 'var(--color-accent-income, #34d399)';

  return (
    <div className={`block-card ${className}`} style={{ borderRadius: 6, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <Avatar name={name} src={src} size={44} color="var(--color-accent-blue, #60a5fa)" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="text-text-primary truncate" style={{ fontSize: 15, fontWeight: 600 }}>
            {name}
          </div>
          {company && (
            <div className="text-text-muted truncate" style={{ fontSize: 12 }}>
              {company}
            </div>
          )}
        </div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '3px 9px',
            borderRadius: '9999px',
            color: statusAccent,
            border: `1px solid ${statusAccent}`,
            backgroundColor: 'color-mix(in srgb, transparent 88%, currentColor)',
            whiteSpace: 'nowrap',
          }}
        >
          {status}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
        <MetaRow icon={Mail} text={email} />
        <MetaRow icon={Phone} text={phone} />
      </div>

      <div
        style={{
          display: 'flex',
          gap: 20,
          marginTop: 14,
          paddingTop: 12,
          borderTop: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        }}
      >
        <Stat label="Balance" value={balance} accent="var(--color-accent-income, #34d399)" />
        <Stat label="Invoices" value={String(invoices)} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* VendorCard — vendor summary card                                    */
/* ------------------------------------------------------------------ */

export interface VendorCardProps {
  name?: string;
  category?: string;
  email?: string;
  location?: string;
  /** Outstanding payable, pre-formatted. */
  payable?: string;
  ytdSpend?: string;
  src?: string;
  className?: string;
}

export function VendorCard({
  name = 'Northwind Supplies',
  category = 'Office & Equipment',
  email = 'billing@northwind.co',
  location = 'Austin, TX',
  payable = '$3,210.00',
  ytdSpend = '$48,920',
  src,
  className = '',
}: VendorCardProps) {
  return (
    <div className={`block-card ${className}`} style={{ borderRadius: 6, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <Avatar name={name} src={src} size={44} color="var(--color-accent-purple, #c084fc)" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="text-text-primary truncate" style={{ fontSize: 15, fontWeight: 600 }}>
            {name}
          </div>
          {category && (
            <div
              className="text-text-secondary truncate"
              style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}
            >
              <Building2 size={12} style={{ color: 'var(--color-text-muted, #5e6178)' }} />
              {category}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
        <MetaRow icon={Mail} text={email} />
        <MetaRow icon={MapPin} text={location} />
      </div>

      <div
        style={{
          display: 'flex',
          gap: 20,
          marginTop: 14,
          paddingTop: 12,
          borderTop: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        }}
      >
        <Stat label="Payable" value={payable} accent="var(--color-accent-expense, #f87171)" />
        <Stat label="YTD spend" value={ytdSpend} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ContactRow — contact list row                                       */
/* ------------------------------------------------------------------ */

export interface ContactRowProps {
  name?: string;
  role?: string;
  email?: string;
  phone?: string;
  src?: string;
  /** Render the trailing actions affordance. */
  showActions?: boolean;
  selected?: boolean;
  className?: string;
  onClick?: () => void;
}

export function ContactRow({
  name = 'Priya Nair',
  role = 'Accounts Payable',
  email = 'priya.nair@acmeretail.com',
  phone = '(415) 555-0147',
  src,
  showActions = true,
  selected = false,
  className = '',
  onClick,
}: ContactRowProps) {
  return (
    <div
      className={className}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        borderRadius: 6,
        cursor: onClick ? 'pointer' : 'default',
        backgroundColor: selected
          ? 'var(--color-accent-blue-bg, rgba(96,165,250,0.12))'
          : 'transparent',
        border: selected
          ? '1px solid var(--color-accent-blue, #60a5fa)'
          : '1px solid var(--color-border, rgba(255,255,255,0.08))',
      }}
    >
      <Avatar name={name} src={src} size={38} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
          <span className="text-text-primary truncate" style={{ fontSize: 13.5, fontWeight: 500 }}>
            {name}
          </span>
          {role && (
            <span className="text-text-muted truncate" style={{ fontSize: 11.5 }}>
              {role}
            </span>
          )}
        </div>
        <div
          className="text-text-secondary truncate"
          style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <User size={11} style={{ display: 'none' }} />
          {email}
        </div>
      </div>

      {phone && (
        <span
          className="text-text-muted"
          style={{ fontSize: 12, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5 }}
        >
          <Phone size={12} />
          {phone}
        </span>
      )}

      {showActions && (
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label="Contact actions"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            borderRadius: 6,
            color: 'var(--color-text-muted, #5e6178)',
            background: 'transparent',
            border: '1px solid transparent',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <MoreHorizontal size={16} />
        </button>
      )}
    </div>
  );
}
