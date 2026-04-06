import React, { useMemo } from 'react';
import { Clock } from 'lucide-react';

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

interface WeeklySummaryProps {
  entries: TimeEntry[];
  weekStart: Date;
}

// ─── Helpers ────────────────────────────────────────────
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatHoursMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function getWeekDates(weekStart: Date): string[] {
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

// ─── Component ──────────────────────────────────────────
const WeeklySummary: React.FC<WeeklySummaryProps> = ({
  entries,
  weekStart,
}) => {
  const stats = useMemo(() => {
    let totalMinutes = 0;
    let billableMinutes = 0;
    let nonBillableMinutes = 0;

    for (const e of entries) {
      const dur = e.duration_minutes ?? 0;
      totalMinutes += dur;
      if (e.is_billable) {
        billableMinutes += dur;
      } else {
        nonBillableMinutes += dur;
      }
    }

    const billablePercent =
      totalMinutes > 0 ? Math.round((billableMinutes / totalMinutes) * 100) : 0;

    // Hours by day
    const weekDates = getWeekDates(weekStart);
    const dayMinutes = weekDates.map((date) =>
      entries
        .filter((e) => e.date === date)
        .reduce((sum, e) => sum + (e.duration_minutes ?? 0), 0)
    );
    const maxDayMinutes = Math.max(...dayMinutes, 1);

    return {
      totalMinutes,
      billableMinutes,
      nonBillableMinutes,
      billablePercent,
      dayMinutes,
      maxDayMinutes,
    };
  }, [entries, weekStart]);

  return (
    <div
      className="block-card p-4 space-y-4"
      style={{ borderRadius: '6px', minWidth: '260px' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <Clock size={14} className="text-accent-blue" />
        <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
          Weekly Summary
        </span>
      </div>

      {/* Total Hours */}
      <div>
        <p className="text-2xl font-mono font-bold text-text-primary">
          {formatHoursMinutes(stats.totalMinutes)}
        </p>
        <p className="text-[10px] text-text-muted uppercase tracking-wider mt-0.5">
          Total Hours
        </p>
      </div>

      {/* Billable / Non-billable Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-sm font-mono font-semibold text-accent-income">
            {formatHoursMinutes(stats.billableMinutes)}
          </p>
          <p className="text-[10px] text-text-muted">Billable</p>
        </div>
        <div>
          <p className="text-sm font-mono font-semibold text-text-secondary">
            {formatHoursMinutes(stats.nonBillableMinutes)}
          </p>
          <p className="text-[10px] text-text-muted">Non-billable</p>
        </div>
      </div>

      {/* Billable Percentage Bar */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-text-muted">Billable ratio</span>
          <span className="text-[10px] font-mono text-text-secondary">
            {stats.billablePercent}%
          </span>
        </div>
        <div
          className="w-full h-2 bg-bg-tertiary overflow-hidden"
          style={{ borderRadius: '6px' }}
        >
          <div className="flex h-full">
            <div
              className="h-full"
              style={{
                width: `${stats.billablePercent}%`,
                backgroundColor: '#22c55e',
                transition: 'width 0.3s ease',
              }}
            />
            <div
              className="h-full"
              style={{
                width: `${100 - stats.billablePercent}%`,
                backgroundColor: '#3a3a3a',
              }}
            />
          </div>
        </div>
      </div>

      {/* Hours by Day Bar Chart */}
      <div>
        <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-2">
          Hours by Day
        </span>
        <div className="flex items-end gap-1.5" style={{ height: '80px' }}>
          {stats.dayMinutes.map((minutes, i) => {
            const heightPct =
              stats.maxDayMinutes > 0
                ? (minutes / stats.maxDayMinutes) * 100
                : 0;
            const isToday =
              new Date(
                new Date(weekStart).setDate(weekStart.getDate() + i)
              )
                .toISOString()
                .slice(0, 10) === new Date().toISOString().slice(0, 10);

            return (
              <div
                key={i}
                className="flex flex-col items-center flex-1"
                style={{ height: '100%' }}
              >
                <div
                  className="flex-1 w-full flex items-end"
                  title={`${DAY_LABELS[i]}: ${formatHoursMinutes(minutes)}`}
                >
                  <div
                    className="w-full"
                    style={{
                      height: `${Math.max(heightPct, minutes > 0 ? 4 : 0)}%`,
                      backgroundColor: isToday
                        ? '#3b82f6'
                        : minutes > 0
                        ? '#22c55e'
                        : '#2e2e2e',
                      borderRadius: '1px 1px 0 0',
                      transition: 'height 0.3s ease',
                    }}
                  />
                </div>
                <span
                  className={`text-[9px] mt-1 ${
                    isToday ? 'text-accent-blue font-semibold' : 'text-text-muted'
                  }`}
                >
                  {DAY_LABELS[i]}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default WeeklySummary;
