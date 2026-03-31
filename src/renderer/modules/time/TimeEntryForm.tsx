import React, { useState, useEffect, useMemo } from 'react';
import { X, Clock } from 'lucide-react';
import api from '../../lib/api';

// ─── Types ──────────────────────────────────────────────
interface Client {
  id: string;
  name: string;
}

interface Project {
  id: string;
  name: string;
  client_id: string;
}

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

interface TimeEntryFormProps {
  entry?: TimeEntry | null;
  clients: Client[];
  projects: Project[];
  onClose: () => void;
  onSaved: () => void;
}

type InputMode = 'range' | 'duration';

// ─── Helpers ────────────────────────────────────────────
function toTimeStr(iso: string): string {
  try {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return '09:00';
  }
}

function toDateStr(iso: string): string {
  try {
    return iso.slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function calcDurationFromRange(date: string, start: string, end: string): number {
  const s = new Date(`${date}T${start}:00`);
  const e = new Date(`${date}T${end}:00`);
  const diff = (e.getTime() - s.getTime()) / 60000;
  return diff > 0 ? Math.round(diff) : 0;
}

// ─── Component ──────────────────────────────────────────
const TimeEntryForm: React.FC<TimeEntryFormProps> = ({
  entry,
  clients,
  projects,
  onClose,
  onSaved,
}) => {
  const isEditing = !!entry;

  const [inputMode, setInputMode] = useState<InputMode>('range');
  const [date, setDate] = useState(
    entry ? toDateStr(entry.date) : new Date().toISOString().slice(0, 10)
  );
  const [startTime, setStartTime] = useState(
    entry ? toTimeStr(entry.start_time) : '09:00'
  );
  const [endTime, setEndTime] = useState(
    entry ? toTimeStr(entry.end_time) : '10:00'
  );
  const [durationMinutes, setDurationMinutes] = useState(
    entry ? entry.duration_minutes : 60
  );
  const [clientId, setClientId] = useState(entry?.client_id ?? '');
  const [projectId, setProjectId] = useState(entry?.project_id ?? '');
  const [description, setDescription] = useState(entry?.description ?? '');
  const [hourlyRate, setHourlyRate] = useState(
    entry?.hourly_rate?.toString() ?? ''
  );
  const [billable, setBillable] = useState(entry?.is_billable ?? true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Auto-calc duration when range changes
  useEffect(() => {
    if (inputMode === 'range') {
      const calc = calcDurationFromRange(date, startTime, endTime);
      setDurationMinutes(calc);
    }
  }, [date, startTime, endTime, inputMode]);

  // Filter projects by client
  const filteredProjects = useMemo(
    () =>
      clientId
        ? projects.filter((p) => p.client_id === clientId)
        : projects,
    [clientId, projects]
  );

  // Reset project when client changes
  useEffect(() => {
    if (clientId && projectId) {
      const valid = projects.find(
        (p) => p.id === projectId && p.client_id === clientId
      );
      if (!valid) setProjectId('');
    }
  }, [clientId]);

  const handleSave = async () => {
    setFormError('');

    let finalStartTime: string;
    let finalEndTime: string;
    let finalDuration: number;

    if (inputMode === 'range') {
      finalStartTime = new Date(`${date}T${startTime}:00`).toISOString();
      finalEndTime = new Date(`${date}T${endTime}:00`).toISOString();
      finalDuration = calcDurationFromRange(date, startTime, endTime);
    } else {
      // Duration mode: set start to 9am, calc end
      finalStartTime = new Date(`${date}T09:00:00`).toISOString();
      const endDate = new Date(
        new Date(`${date}T09:00:00`).getTime() + durationMinutes * 60000
      );
      finalEndTime = endDate.toISOString();
      finalDuration = durationMinutes;
    }

    if (finalDuration < 1) {
      setFormError('Duration must be greater than 0.');
      return;
    }
    setSaving(true);

    const data = {
      date,
      start_time: finalStartTime,
      end_time: finalEndTime,
      duration_minutes: finalDuration,
      client_id: clientId || null,
      project_id: projectId || null,
      description: description || null,
      hourly_rate: hourlyRate ? parseFloat(hourlyRate) : null,
      is_billable: billable,
    };

    try {
      if (isEditing && entry) {
        await api.update('time_entries', entry.id, data);
      } else {
        await api.create('time_entries', data);
      }
      onSaved();
      onClose();
    } catch (err) {
      console.error('Failed to save time entry:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
    >
      <div
        className="block-card-elevated w-full max-w-lg"
        style={{ borderRadius: '2px' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-accent-blue" />
            <h2 className="text-sm font-bold text-text-primary">
              {isEditing ? 'Edit Time Entry' : 'New Time Entry'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-bg-hover transition-colors text-text-muted hover:text-text-primary"
            style={{ borderRadius: '2px' }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Date */}
          <div>
            <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">
              Date
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="block-input"
            />
          </div>

          {/* Input Mode Toggle */}
          <div>
            <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">
              Time Input
            </label>
            <div className="flex gap-1">
              <button
                onClick={() => setInputMode('range')}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                  inputMode === 'range'
                    ? 'bg-accent-blue text-white'
                    : 'bg-bg-tertiary text-text-muted hover:text-text-primary'
                }`}
                style={{ borderRadius: '2px' }}
              >
                Time Range
              </button>
              <button
                onClick={() => setInputMode('duration')}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                  inputMode === 'duration'
                    ? 'bg-accent-blue text-white'
                    : 'bg-bg-tertiary text-text-muted hover:text-text-primary'
                }`}
                style={{ borderRadius: '2px' }}
              >
                Duration
              </button>
            </div>
          </div>

          {/* Time Range or Duration */}
          {inputMode === 'range' ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">
                  Start Time
                </label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="block-input"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">
                  End Time
                </label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="block-input"
                />
              </div>
              {durationMinutes > 0 && (
                <div className="col-span-2 text-xs text-text-muted">
                  Duration:{' '}
                  <span className="font-mono text-text-secondary">
                    {Math.floor(durationMinutes / 60)}h {durationMinutes % 60}m
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div>
              <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">
                Duration (minutes)
              </label>
              <input
                type="number"
                value={durationMinutes}
                onChange={(e) =>
                  setDurationMinutes(Math.max(0, parseInt(e.target.value) || 0))
                }
                min={1}
                className="block-input"
                placeholder="60"
              />
              {durationMinutes > 0 && (
                <div className="text-xs text-text-muted mt-1">
                  ={' '}
                  <span className="font-mono text-text-secondary">
                    {Math.floor(durationMinutes / 60)}h {durationMinutes % 60}m
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Client */}
          <div>
            <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">
              Client
            </label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="block-select"
            >
              <option value="">No client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Project */}
          <div>
            <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">
              Project
            </label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="block-select"
            >
              <option value="">No project</option>
              {filteredProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div>
            <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="block-input"
              placeholder="What did you work on?"
            />
          </div>

          {/* Hourly Rate & Billable */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">
                Hourly Rate
              </label>
              <input
                type="number"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
                className="block-input"
                placeholder="0.00"
                min={0}
                step="0.01"
              />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={billable}
                  onChange={(e) => setBillable(e.target.checked)}
                  className="w-4 h-4 accent-accent-income"
                />
                <span className="text-xs text-text-secondary">Billable</span>
              </label>
            </div>
          </div>
        </div>

        {/* Error */}
        {formError && (
          <div
            className="text-xs text-accent-expense bg-accent-expense/10 px-3 py-2 border border-accent-expense/20 mt-4"
            style={{ borderRadius: '2px' }}
          >
            {formError}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-border-primary">
          <button
            onClick={onClose}
            className="block-btn px-4 py-2 text-xs font-semibold"
            style={{ borderRadius: '2px' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="block-btn-primary px-4 py-2 text-xs font-semibold"
            style={{ borderRadius: '2px', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? 'Saving...' : isEditing ? 'Update Entry' : 'Create Entry'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TimeEntryForm;
