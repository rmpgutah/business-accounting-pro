import React, { useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  Clock,
  Pencil,
  Trash2,
} from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { formatDate } from '../../lib/format';

// ─── Types ──────────────────────────────────────────────
interface TimeEntry {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  client_id: string | null;
  project_id: string | null;
  description: string | null;
  hourly_rate?: number;
  is_billable: boolean;
}

interface Client {
  id: string;
  name: string;
}

interface Project {
  id: string;
  name: string;
  client_id: string;
}

interface TimeEntryListProps {
  entries: TimeEntry[];
  clients: Client[];
  projects: Project[];
  weekStart: Date;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onEdit: (entry: TimeEntry) => void;
  onDelete: (id: string) => void;
}

// ─── Helpers ────────────────────────────────────────────
function formatHoursMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function formatTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '--:--';
  }
}

function formatDateHeader(dateStr: string): string {
  return formatDate(dateStr);
}

function formatWeekRange(start: Date): string {
  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const startStr = start.toLocaleDateString('en-US', opts);
  const endStr = end.toLocaleDateString('en-US', {
    ...opts,
    year: 'numeric',
  });
  return `${startStr} - ${endStr}`;
}

function isToday(dateStr: string): boolean {
  return dateStr === new Date().toISOString().slice(0, 10);
}

// ─── Grouped Entries ────────────────────────────────────
interface DayGroup {
  date: string;
  entries: TimeEntry[];
  totalMinutes: number;
}

function groupByDate(entries: TimeEntry[]): DayGroup[] {
  const map = new Map<string, TimeEntry[]>();

  for (const entry of entries) {
    const date = entry.date;
    if (!map.has(date)) map.set(date, []);
    map.get(date)!.push(entry);
  }

  const groups: DayGroup[] = [];
  for (const [date, items] of map) {
    groups.push({
      date,
      entries: items.sort(
        (a, b) =>
          new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
      ),
      totalMinutes: items.reduce((sum, e) => sum + (e.duration_minutes ?? 0), 0),
    });
  }

  return groups.sort((a, b) => b.date.localeCompare(a.date));
}

// ─── Component ──────────────────────────────────────────
const TimeEntryList: React.FC<TimeEntryListProps> = ({
  entries,
  clients,
  projects,
  weekStart,
  onPrevWeek,
  onNextWeek,
  onEdit,
  onDelete,
}) => {
  const clientMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clients) m.set(c.id, c.name);
    return m;
  }, [clients]);

  const projectMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) m.set(p.id, p.name);
    return m;
  }, [projects]);

  const dayGroups = useMemo(() => groupByDate(entries), [entries]);

  return (
    <div className="space-y-4 flex-1">
      {/* Week Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-text-muted" />
          <span className="text-sm font-semibold text-text-primary">
            {formatWeekRange(weekStart)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onPrevWeek}
            className="block-btn px-2 py-1"
            style={{ borderRadius: '6px' }}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={onNextWeek}
            className="block-btn px-2 py-1"
            style={{ borderRadius: '6px' }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Day Groups */}
      {dayGroups.length === 0 && (
        <EmptyState icon={Clock} message="No time entries this week" />
      )}

      {dayGroups.map((group) => (
        <div key={group.date}>
          {/* Day Header */}
          <div
            className="flex items-center justify-between px-3 py-2 mb-1"
            style={{
              backgroundColor: isToday(group.date) ? 'rgba(59,130,246,0.06)' : '#1e1e1e',
              border: '1px solid #2e2e2e',
              borderRadius: '6px',
            }}
          >
            <span className="text-xs font-semibold text-text-primary">
              {formatDateHeader(group.date)}
              {isToday(group.date) && (
                <span className="ml-2 text-accent-blue text-[10px]">TODAY</span>
              )}
            </span>
            <span className="text-xs font-mono text-text-secondary">
              {formatHoursMinutes(group.totalMinutes)}
            </span>
          </div>

          {/* Entries */}
          <div
            className="bg-bg-secondary border border-border-primary overflow-hidden mb-3"
            style={{ borderRadius: '6px' }}
          >
            {group.entries.map((entry, idx) => (
              <div
                key={entry.id}
                className="flex items-center gap-4 px-4 py-3 hover:bg-bg-hover transition-colors"
                style={{
                  borderBottom:
                    idx < group.entries.length - 1
                      ? '1px solid #2e2e2e'
                      : 'none',
                }}
              >
                {/* Time Range */}
                <div className="min-w-[120px]">
                  <span className="text-xs font-mono text-text-secondary">
                    {formatTime(entry.start_time)} - {formatTime(entry.end_time)}
                  </span>
                </div>

                {/* Duration */}
                <div className="min-w-[70px]">
                  <span className="text-xs font-mono font-semibold text-text-primary">
                    {formatHoursMinutes(entry.duration_minutes)}
                  </span>
                </div>

                {/* Client / Project */}
                <div className="min-w-[140px]">
                  {entry.client_id && (
                    <span className="text-xs text-text-secondary">
                      {clientMap.get(entry.client_id) ?? 'Unknown'}
                    </span>
                  )}
                  {entry.project_id && (
                    <span className="text-xs text-text-muted ml-1">
                      / {projectMap.get(entry.project_id) ?? 'Unknown'}
                    </span>
                  )}
                  {!entry.client_id && !entry.project_id && (
                    <span className="text-xs text-text-muted">No client</span>
                  )}
                </div>

                {/* Description */}
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-text-primary truncate block">
                    {entry.description || '(no description)'}
                  </span>
                </div>

                {/* Billable Indicator */}
                <div className="min-w-[24px] text-center">
                  {entry.is_billable ? (
                    <span
                      className="block-badge-income text-[10px] px-1.5 py-0.5"
                      style={{ borderRadius: '6px' }}
                    >
                      $
                    </span>
                  ) : (
                    <span className="text-text-muted text-[10px]">--</span>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 min-w-[56px]">
                  <button
                    onClick={() => onEdit(entry)}
                    className="p-1.5 hover:bg-bg-tertiary transition-colors text-text-muted hover:text-text-primary"
                    style={{ borderRadius: '6px' }}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => onDelete(entry.id)}
                    className="p-1.5 hover:bg-bg-tertiary transition-colors text-text-muted hover:text-accent-expense"
                    style={{ borderRadius: '6px' }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default TimeEntryList;
