// src/renderer/components/EntityTimeline.tsx
//
// Reusable "activity" timeline for any entity. Merges audit_log + email_log
// + notifications + documents into one chronological feed.

import React, { useEffect, useState } from 'react';
import { Activity, FileText, Mail, Bell, Edit3, AlertCircle, Printer, Download } from 'lucide-react';
import api from '../lib/api';
import { useCompanyStore } from '../stores/companyStore';

interface Event {
  id: string;
  at: string;
  kind: 'audit' | 'email' | 'notification' | 'document' | 'stripe';
  action: string;
  title: string;
  detail?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

interface Props {
  entityType: string;
  entityId: string;
  limit?: number;
  compact?: boolean;
}

function iconFor(ev: Event): React.ReactNode {
  if (ev.kind === 'email') return <Mail size={12} className="text-accent-blue" />;
  if (ev.kind === 'notification') return <Bell size={12} className="text-accent-warning" />;
  if (ev.kind === 'document') return <FileText size={12} className="text-accent-purple" />;
  if (ev.kind === 'stripe') return <AlertCircle size={12} className="text-accent-blue" />;
  // audit — distinguish by action
  if (/pdf/.test(ev.action)) return <Download size={12} className="text-text-muted" />;
  if (/print/.test(ev.action)) return <Printer size={12} className="text-text-muted" />;
  if (/email/.test(ev.action)) return <Mail size={12} className="text-accent-blue" />;
  return <Edit3 size={12} className="text-text-muted" />;
}

function relativeTime(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const diff = Date.now() - then;
    if (isNaN(diff)) return iso;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
  } catch { return iso; }
}

const EntityTimeline: React.FC<Props> = ({ entityType, entityId, limit = 50, compact }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany?.id || !entityId) { setEvents([]); return; }
      setLoading(true);
      try {
        const result = await api.entity.timeline(activeCompany.id, entityType, entityId, limit);
        if (!cancelled) setEvents(result as Event[]);
      } catch {
        if (!cancelled) setEvents([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeCompany?.id, entityType, entityId, limit]);

  return (
    <div className={compact ? '' : 'block-card p-4'} style={{ borderRadius: compact ? 0 : 2 }}>
      {!compact && (
        <div className="flex items-center gap-2 pb-2 mb-3 border-b border-border-primary">
          <Activity size={14} className="text-accent-blue" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary">Activity</h3>
          {loading && <span className="text-[10px] text-text-muted ml-auto font-mono">Loading…</span>}
        </div>
      )}

      {events.length === 0 && !loading && (
        <p className="text-xs text-text-muted italic">No activity recorded yet.</p>
      )}

      <ol className="space-y-2">
        {events.map((ev) => (
          <li key={ev.id} className="flex gap-2 text-xs">
            <span className="mt-0.5 shrink-0">{iconFor(ev)}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-text-primary truncate">{ev.title}</span>
                <time className="text-[10px] text-text-muted shrink-0 font-mono" title={ev.at}>{relativeTime(ev.at)}</time>
              </div>
              {ev.detail && <div className="text-[11px] text-text-secondary truncate">{ev.detail}</div>}
              {ev.source && <div className="text-[10px] text-text-muted">{ev.source}</div>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
};

export default EntityTimeline;
