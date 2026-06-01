import React from 'react';
import {
  ChevronRight,
  ChevronLeft,
  Home,
  ArrowLeft,
  Check,
  MoreHorizontal,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Breadcrumb                                                          */
/* ------------------------------------------------------------------ */

export interface BreadcrumbItem {
  label: string;
  href?: string;
  onClick?: () => void;
}

export interface BreadcrumbProps {
  items?: BreadcrumbItem[];
  showHome?: boolean;
  className?: string;
}

export function Breadcrumb({
  items = [
    { label: 'Dashboard' },
    { label: 'Reports' },
    { label: 'Profit & Loss' },
  ],
  showHome = true,
  className = '',
}: BreadcrumbProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={`flex items-center flex-wrap text-sm ${className}`}
      style={{ gap: 4 }}
    >
      {showHome && (
        <>
          <button
            type="button"
            className="flex items-center text-text-muted hover:text-text-primary transition-colors"
            style={{ padding: '2px 4px', borderRadius: 6 }}
          >
            <Home size={14} />
          </button>
          <ChevronRight size={14} className="text-text-muted" />
        </>
      )}
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <React.Fragment key={`${item.label}-${i}`}>
            <button
              type="button"
              onClick={item.onClick}
              aria-current={isLast ? 'page' : undefined}
              className={`transition-colors ${
                isLast
                  ? 'text-text-primary font-medium cursor-default'
                  : 'text-text-muted hover:text-text-primary'
              }`}
              style={{ padding: '2px 4px', borderRadius: 6 }}
            >
              {item.label}
            </button>
            {!isLast && <ChevronRight size={14} className="text-text-muted" />}
          </React.Fragment>
        );
      })}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Pagination                                                          */
/* ------------------------------------------------------------------ */

export interface PaginationProps {
  page?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
  siblingCount?: number;
  className?: string;
}

function buildPageList(
  page: number,
  totalPages: number,
  siblingCount: number,
): (number | 'ellipsis')[] {
  const totalNumbers = siblingCount * 2 + 5;
  if (totalPages <= totalNumbers) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const left = Math.max(page - siblingCount, 1);
  const right = Math.min(page + siblingCount, totalPages);
  const showLeftDots = left > 2;
  const showRightDots = right < totalPages - 1;
  const result: (number | 'ellipsis')[] = [1];
  if (showLeftDots) result.push('ellipsis');
  for (let p = left; p <= right; p++) {
    if (p !== 1 && p !== totalPages) result.push(p);
  }
  if (showRightDots) result.push('ellipsis');
  result.push(totalPages);
  return result;
}

export function Pagination({
  page = 3,
  totalPages = 12,
  onPageChange,
  siblingCount = 1,
  className = '',
}: PaginationProps) {
  const safeTotal = Math.max(1, totalPages);
  const current = Math.min(Math.max(1, page), safeTotal);
  const pages = buildPageList(current, safeTotal, siblingCount);

  const go = (p: number) => {
    if (p < 1 || p > safeTotal || p === current) return;
    onPageChange?.(p);
  };

  const btnBase =
    'flex items-center justify-center text-sm transition-colors border';
  const btnStyle: React.CSSProperties = {
    minWidth: 32,
    height: 32,
    padding: '0 8px',
    borderRadius: 6,
  };

  return (
    <nav
      aria-label="Pagination"
      className={`flex items-center ${className}`}
      style={{ gap: 4 }}
    >
      <button
        type="button"
        onClick={() => go(current - 1)}
        disabled={current <= 1}
        aria-label="Previous page"
        className={`${btnBase} bg-bg-secondary border-border-primary text-text-secondary hover:text-text-primary hover:border-border-secondary disabled:opacity-40 disabled:cursor-not-allowed`}
        style={btnStyle}
      >
        <ChevronLeft size={16} />
      </button>

      {pages.map((p, i) =>
        p === 'ellipsis' ? (
          <span
            key={`e-${i}`}
            className="flex items-center justify-center text-text-muted"
            style={{ minWidth: 32, height: 32 }}
          >
            <MoreHorizontal size={16} />
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => go(p)}
            aria-current={p === current ? 'page' : undefined}
            className={`${btnBase} ${
              p === current
                ? 'text-white border-transparent'
                : 'bg-bg-secondary border-border-primary text-text-secondary hover:text-text-primary hover:border-border-secondary'
            }`}
            style={{
              ...btnStyle,
              backgroundColor:
                p === current ? 'var(--color-accent-blue, #3b82f6)' : undefined,
              fontWeight: p === current ? 600 : 400,
            }}
          >
            {p}
          </button>
        ),
      )}

      <button
        type="button"
        onClick={() => go(current + 1)}
        disabled={current >= safeTotal}
        aria-label="Next page"
        className={`${btnBase} bg-bg-secondary border-border-primary text-text-secondary hover:text-text-primary hover:border-border-secondary disabled:opacity-40 disabled:cursor-not-allowed`}
        style={btnStyle}
      >
        <ChevronRight size={16} />
      </button>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* BackButton                                                          */
/* ------------------------------------------------------------------ */

export interface BackButtonProps {
  label?: string;
  onClick?: () => void;
  className?: string;
}

export function BackButton({
  label = 'Back',
  onClick,
  className = '',
}: BackButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center text-sm text-text-secondary hover:text-text-primary transition-colors ${className}`}
      style={{ gap: 6, padding: '6px 10px', borderRadius: 6 }}
    >
      <ArrowLeft size={16} />
      <span>{label}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* StepWizardNav                                                       */
/* ------------------------------------------------------------------ */

export interface WizardStep {
  label: string;
  description?: string;
}

export interface StepWizardNavProps {
  steps?: WizardStep[];
  current?: number;
  onStepClick?: (index: number) => void;
  className?: string;
}

export function StepWizardNav({
  steps = [
    { label: 'Company', description: 'Basic details' },
    { label: 'Accounts', description: 'Chart of accounts' },
    { label: 'Import', description: 'Existing data' },
    { label: 'Review', description: 'Confirm setup' },
  ],
  current = 1,
  onStepClick,
  className = '',
}: StepWizardNavProps) {
  return (
    <nav
      aria-label="Progress"
      className={`flex items-start w-full ${className}`}
    >
      {steps.map((step, i) => {
        const isDone = i < current;
        const isActive = i === current;
        const isLast = i === steps.length - 1;

        const circleColor = isDone
          ? 'var(--color-accent-income, #22c55e)'
          : isActive
          ? 'var(--color-accent-blue, #3b82f6)'
          : 'var(--color-bg-tertiary, #2e2e2e)';

        return (
          <React.Fragment key={`${step.label}-${i}`}>
            <button
              type="button"
              onClick={() => onStepClick?.(i)}
              className="flex flex-col items-center text-center"
              style={{ minWidth: 72, flex: '0 0 auto' }}
            >
              <span
                className="flex items-center justify-center font-medium"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 6,
                  backgroundColor: circleColor,
                  color: isDone || isActive ? '#fff' : 'var(--color-text-muted, #888)',
                  border: isActive
                    ? '2px solid var(--color-accent-blue, #3b82f6)'
                    : '1px solid var(--color-border-primary, #333)',
                  fontSize: 13,
                }}
              >
                {isDone ? <Check size={16} /> : i + 1}
              </span>
              <span
                className={`text-xs mt-2 ${
                  isActive
                    ? 'text-text-primary font-medium'
                    : isDone
                    ? 'text-text-secondary'
                    : 'text-text-muted'
                }`}
              >
                {step.label}
              </span>
              {step.description && (
                <span className="text-text-muted" style={{ fontSize: 11, marginTop: 2 }}>
                  {step.description}
                </span>
              )}
            </button>
            {!isLast && (
              <div
                className="flex-1"
                style={{
                  height: 2,
                  marginTop: 15,
                  minWidth: 16,
                  backgroundColor: isDone
                    ? 'var(--color-accent-income, #22c55e)'
                    : 'var(--color-border-primary, #333)',
                }}
              />
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* AnchorNav                                                           */
/* ------------------------------------------------------------------ */

export interface AnchorNavItem {
  id: string;
  label: string;
}

export interface AnchorNavProps {
  items?: AnchorNavItem[];
  activeId?: string;
  onSelect?: (id: string) => void;
  title?: string;
  className?: string;
}

export function AnchorNav({
  items = [
    { id: 'overview', label: 'Overview' },
    { id: 'income', label: 'Income' },
    { id: 'expenses', label: 'Expenses' },
    { id: 'taxes', label: 'Taxes' },
    { id: 'summary', label: 'Summary' },
  ],
  activeId,
  onSelect,
  title = 'On this page',
  className = '',
}: AnchorNavProps) {
  const active = activeId ?? items[0]?.id;

  return (
    <nav
      aria-label="Section navigation"
      className={`block-card ${className}`}
      style={{ padding: 12, minWidth: 180 }}
    >
      {title && (
        <div
          className="text-text-muted uppercase tracking-wide"
          style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, paddingLeft: 10 }}
        >
          {title}
        </div>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {items.map((item) => {
          const isActive = item.id === active;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onSelect?.(item.id)}
                aria-current={isActive ? 'true' : undefined}
                className={`w-full text-left text-sm transition-colors ${
                  isActive
                    ? 'text-text-primary font-medium'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
                style={{
                  padding: '6px 10px',
                  borderRadius: 6,
                  borderLeft: isActive
                    ? '2px solid var(--color-accent-blue, #3b82f6)'
                    : '2px solid transparent',
                  backgroundColor: isActive
                    ? 'var(--color-bg-tertiary, #2e2e2e)'
                    : 'transparent',
                }}
              >
                {item.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
