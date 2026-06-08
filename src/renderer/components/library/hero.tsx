import { useId } from 'react';
import {
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  Sparkles,
  Zap,
  Sun,
  type LucideIcon,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

const ACCENTS: Record<string, { fg: string; bg: string }> = {
  blue: { fg: 'var(--color-accent-blue)', bg: 'var(--color-accent-blue-bg)' },
  income: { fg: 'var(--color-accent-income)', bg: 'var(--color-accent-income-bg)' },
  expense: { fg: 'var(--color-accent-expense)', bg: 'var(--color-accent-expense-bg)' },
  warning: { fg: 'var(--color-accent-warning)', bg: 'var(--color-accent-warning-bg)' },
  purple: { fg: 'var(--color-accent-purple)', bg: 'var(--color-accent-purple-bg)' },
};

type AccentKey = keyof typeof ACCENTS;

function accent(key: AccentKey): { fg: string; bg: string } {
  return ACCENTS[key] ?? ACCENTS.blue;
}

/* ------------------------------------------------------------------ */
/* HeroStat — large hero metric                                        */
/* ------------------------------------------------------------------ */

export interface HeroStatProps {
  label?: string;
  value?: string;
  caption?: string;
  accentColor?: AccentKey;
  icon?: LucideIcon;
}

export function HeroStat({
  label = 'Total Revenue',
  value = '$1,284,920',
  caption = 'Fiscal year to date',
  accentColor = 'income',
  icon: Icon = TrendingUp,
}: HeroStatProps) {
  const a = accent(accentColor);
  return (
    <div
      className="block-card-elevated"
      style={{ padding: 28, borderRadius: 6, position: 'relative', overflow: 'hidden' }}
    >
      <div
        style={{
          position: 'absolute',
          top: -40,
          right: -40,
          width: 160,
          height: 160,
          borderRadius: '50%',
          background: a.bg,
          filter: 'blur(8px)',
          opacity: 0.6,
        }}
      />
      <div style={{ position: 'relative' }}>
        <div className="flex items-center justify-between">
          <span
            className="text-xs uppercase tracking-wide text-text-secondary"
            style={{ letterSpacing: '0.08em' }}
          >
            {label}
          </span>
          <div
            className="flex items-center justify-center"
            style={{ width: 40, height: 40, borderRadius: 6, background: a.bg }}
          >
            <Icon size={20} style={{ color: a.fg }} />
          </div>
        </div>
        <div
          className="font-mono text-text-primary"
          style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.1, marginTop: 14 }}
        >
          {value}
        </div>
        <div className="text-sm text-text-muted" style={{ marginTop: 8 }}>
          {caption}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* FeatureCard — feature highlight card                                */
/* ------------------------------------------------------------------ */

export interface FeatureCardProps {
  title?: string;
  description?: string;
  icon?: LucideIcon;
  accentColor?: AccentKey;
  badge?: string;
}

export function FeatureCard({
  title = 'Automated Reconciliation',
  description = 'Match bank transactions to your ledger automatically and flag discrepancies in real time.',
  icon: Icon = Zap,
  accentColor = 'blue',
  badge,
}: FeatureCardProps) {
  const a = accent(accentColor);
  return (
    <div className="block-card" style={{ padding: 22, borderRadius: 6 }}>
      <div
        className="flex items-center justify-center"
        style={{ width: 44, height: 44, borderRadius: 6, background: a.bg }}
      >
        <Icon size={22} style={{ color: a.fg }} />
      </div>
      <div className="flex items-center" style={{ marginTop: 16, gap: 8 }}>
        <h3 className="text-text-primary" style={{ fontSize: 16, fontWeight: 600 }}>
          {title}
        </h3>
        {badge && (
          <span
            className="text-xs"
            style={{
              padding: '2px 8px',
              borderRadius: 6,
              background: a.bg,
              color: a.fg,
              fontWeight: 600,
            }}
          >
            {badge}
          </span>
        )}
      </div>
      <p className="text-sm text-text-secondary" style={{ marginTop: 8, lineHeight: 1.5 }}>
        {description}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* CtaBanner — call-to-action banner                                   */
/* ------------------------------------------------------------------ */

export interface CtaBannerProps {
  title?: string;
  subtitle?: string;
  buttonLabel?: string;
  accentColor?: AccentKey;
  icon?: LucideIcon;
  onClick?: () => void;
}

export function CtaBanner({
  title = 'Ready to close your books?',
  subtitle = 'Run month-end automation and generate statements in one click.',
  buttonLabel = 'Get Started',
  accentColor = 'purple',
  icon: Icon = Sparkles,
  onClick,
}: CtaBannerProps) {
  const a = accent(accentColor);
  return (
    <div
      className="block-card-elevated flex items-center justify-between"
      style={{
        padding: 24,
        borderRadius: 6,
        gap: 20,
        background: `linear-gradient(135deg, ${a.bg}, var(--color-bg-elevated))`,
      }}
    >
      <div className="flex items-center" style={{ gap: 16 }}>
        <div
          className="flex items-center justify-center"
          style={{ width: 48, height: 48, borderRadius: 6, background: a.bg, flexShrink: 0 }}
        >
          <Icon size={24} style={{ color: a.fg }} />
        </div>
        <div>
          <div className="text-text-primary" style={{ fontSize: 17, fontWeight: 600 }}>
            {title}
          </div>
          <div className="text-sm text-text-secondary" style={{ marginTop: 4 }}>
            {subtitle}
          </div>
        </div>
      </div>
      <button
        className="block-btn block-btn-primary"
        onClick={onClick}
        style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
      >
        {buttonLabel}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* MetricHero — metric with trend hero                                 */
/* ------------------------------------------------------------------ */

export interface MetricHeroProps {
  label?: string;
  value?: string;
  deltaPct?: number;
  deltaLabel?: string;
  spark?: number[];
  accentColor?: AccentKey;
}

export function MetricHero({
  label = 'Net Profit',
  value = '$342,180',
  deltaPct = 12.4,
  deltaLabel = 'vs last quarter',
  spark = [12, 18, 15, 22, 19, 28, 26, 34, 31, 40],
  accentColor = 'income',
}: MetricHeroProps) {
  const a = accent(accentColor);
  const up = deltaPct >= 0;
  const DeltaIcon = up ? ArrowUpRight : ArrowDownRight;
  const deltaColor = up ? 'var(--color-accent-income)' : 'var(--color-accent-expense)';
  // Unique gradient id per instance — a shared id makes every MetricHero on the
  // page reuse the first one's <defs>, which can blank or mis-color the fill.
  const gradId = useId();

  // build sparkline path. Inset by half the stroke width so the 2px line never
  // clips against the SVG edges once overflow is hidden.
  const sw = 2;
  const w = 120;
  const h = 40;
  const max = Math.max(...spark, 1);
  const min = Math.min(...spark, 0);
  const range = max - min || 1;
  const pts = spark.map((v, i) => {
    const x = sw / 2 + (spark.length > 1 ? (i / (spark.length - 1)) * (w - sw) : 0);
    const y = sw / 2 + (h - sw) - ((v - min) / range) * (h - sw);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const linePath = `M ${pts.join(' L ')}`;
  const areaPath = `${linePath} L ${w},${h} L 0,${h} Z`;

  return (
    <div className="block-card" style={{ padding: 24, borderRadius: 6 }}>
      <div className="flex items-start justify-between" style={{ gap: 16 }}>
        <div>
          <div className="text-xs uppercase text-text-secondary" style={{ letterSpacing: '0.08em' }}>
            {label}
          </div>
          <div
            className="font-mono text-text-primary"
            style={{ fontSize: 32, fontWeight: 700, marginTop: 8, lineHeight: 1.1 }}
          >
            {value}
          </div>
          <div className="flex items-center" style={{ marginTop: 10, gap: 6 }}>
            <span
              className="flex items-center text-xs"
              style={{
                color: deltaColor,
                fontWeight: 600,
                padding: '2px 6px',
                borderRadius: 6,
                background: up ? 'var(--color-accent-income-bg)' : 'var(--color-accent-expense-bg)',
              }}
            >
              <DeltaIcon size={13} style={{ marginRight: 2 }} />
              {Math.abs(deltaPct).toFixed(1)}%
            </span>
            <span className="text-xs text-text-muted">{deltaLabel}</span>
          </div>
        </div>
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ flexShrink: 0, overflow: 'hidden' }} role="img" aria-label={`${label} trend`}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={a.fg} stopOpacity={0.28} />
              <stop offset="100%" stopColor={a.fg} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradId})`} />
          <path d={linePath} fill="none" stroke={a.fg} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* WelcomeCard — welcome/greeting card                                 */
/* ------------------------------------------------------------------ */

export interface WelcomeCardProps {
  greeting?: string;
  name?: string;
  message?: string;
  icon?: LucideIcon;
  accentColor?: AccentKey;
  stats?: { label: string; value: string }[];
}

export function WelcomeCard({
  greeting = 'Good morning',
  name = 'Alex',
  message = "Here's what's happening across your books today.",
  icon: Icon = Sun,
  accentColor = 'warning',
  stats = [
    { label: 'Open Invoices', value: '14' },
    { label: 'Cash on Hand', value: '$82.4k' },
    { label: 'Due This Week', value: '3' },
  ],
}: WelcomeCardProps) {
  const a = accent(accentColor);
  return (
    <div
      className="block-card-elevated"
      style={{
        padding: 26,
        borderRadius: 6,
        background: `linear-gradient(135deg, ${a.bg}, var(--color-bg-elevated))`,
      }}
    >
      <div className="flex items-center" style={{ gap: 14 }}>
        <div
          className="flex items-center justify-center"
          style={{ width: 46, height: 46, borderRadius: 6, background: a.bg, flexShrink: 0 }}
        >
          <Icon size={24} style={{ color: a.fg }} />
        </div>
        <div>
          <div className="text-text-primary" style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>
            {greeting}, {name}
          </div>
          <div className="text-sm text-text-secondary" style={{ marginTop: 2 }}>
            {message}
          </div>
        </div>
      </div>
      {stats.length > 0 && (
        <div
          className="flex"
          style={{
            marginTop: 22,
            gap: 12,
            borderTop: '1px solid var(--color-glass-border)',
            paddingTop: 18,
          }}
        >
          {stats.map((s, i) => (
            <div key={i} style={{ flex: 1 }}>
              <div className="font-mono text-text-primary" style={{ fontSize: 20, fontWeight: 700 }}>
                {s.value}
              </div>
              <div className="text-xs text-text-muted" style={{ marginTop: 2 }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
