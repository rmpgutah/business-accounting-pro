// src/renderer/components/RecentlyViewedDropdown.tsx
//
// P3.32 — Recently-viewed dropdown UI.
//
// Surfaces the last 20 entities the user opened (any kind) as a
// quick-jump dropdown. Tracker hook lives at hooks/useRecentlyViewed.ts;
// this component just renders + handles selection.

import React, { useState, useEffect, useRef } from 'react';
import { Clock, FileText, Users, DollarSign, Briefcase, Receipt, BookOpen } from 'lucide-react';
import { useRecentlyViewed, type RecentItem } from '../hooks/useRecentlyViewed';
import { useCompanyStore } from '../stores/companyStore';

interface Props {
  onNavigate: (item: RecentItem) => void;
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  invoice: <FileText size={12} />,
  client: <Users size={12} />,
  vendor: <Briefcase size={12} />,
  expense: <Receipt size={12} />,
  bill: <DollarSign size={12} />,
  journal_entry: <BookOpen size={12} />,
  project: <Briefcase size={12} />,
};

const TYPE_LABEL: Record<string, string> = {
  invoice: 'Invoice',
  client: 'Client',
  vendor: 'Vendor',
  expense: 'Expense',
  bill: 'Bill',
  journal_entry: 'Journal',
  project: 'Project',
};

export const RecentlyViewedDropdown: React.FC<Props> = ({ onNavigate }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const { items } = useRecentlyViewed(activeCompany?.id || '');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Recently viewed"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '6px 10px',
          background: 'transparent',
          border: '1px solid var(--color-border-primary)',
          borderRadius: 6,
          color: 'var(--color-text-primary)',
          cursor: 'pointer',
          fontSize: 11,
          fontWeight: 600,
        }}
      >
        <Clock size={13} />
        <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
          ({items.length})
        </span>
      </button>

      {open && items.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            minWidth: 320,
            maxWidth: 400,
            maxHeight: 400,
            overflowY: 'auto',
            background: 'var(--color-bg-primary)',
            border: '1px solid var(--color-border-primary)',
            borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
            zIndex: 1000,
            padding: 4,
          }}
        >
          <div style={{ padding: '6px 10px', fontSize: 9, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800 }}>
            Recently viewed
          </div>
          {items.map((item) => (
            <button
              key={item.type + ':' + item.id}
              onClick={() => { onNavigate(item); setOpen(false); }}
              style={{
                width: '100%',
                textAlign: 'left',
                background: 'transparent',
                border: 'none',
                padding: '8px 10px',
                borderRadius: 4,
                cursor: 'pointer',
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg-secondary)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{ marginTop: 1, flexShrink: 0, color: 'var(--color-text-muted)' }}>
                {TYPE_ICON[item.type] || <FileText size={12} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--color-text-primary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {item.label}
                </div>
                <div style={{
                  fontSize: 10,
                  color: 'var(--color-text-muted)',
                  marginTop: 1,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {TYPE_LABEL[item.type] || item.type}
                  {item.subtitle ? ' · ' + item.subtitle : ''}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default RecentlyViewedDropdown;
