import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Square, Pause, Clock, AlertCircle } from 'lucide-react';
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

interface TimerWidgetProps {
  clients: Client[];
  projects: Project[];
  onEntryCreated: () => void;
}

type TimerState = 'idle' | 'running' | 'paused';

// ─── Session Storage Key ────────────────────────────────
const TIMER_STORAGE_KEY = 'bap_active_timer';

interface PersistedTimer {
  timerState: TimerState;
  originalStartISO: string;       // ISO string of when the timer was first started
  accumulatedSeconds: number;      // seconds accumulated before current segment
  segmentStartMs: number;          // Date.now() when current running segment began
  clientId: string;
  projectId: string;
  description: string;
  billable: boolean;
}

function loadPersistedTimer(): PersistedTimer | null {
  try {
    const raw = sessionStorage.getItem(TIMER_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function savePersistedTimer(data: PersistedTimer | null) {
  if (!data || data.timerState === 'idle') {
    sessionStorage.removeItem(TIMER_STORAGE_KEY);
  } else {
    sessionStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(data));
  }
}

// ─── Helpers ────────────────────────────────────────────
function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ─── Component ──────────────────────────────────────────
const TimerWidget: React.FC<TimerWidgetProps> = ({
  clients,
  projects,
  onEntryCreated,
}) => {
  // Restore persisted state on mount
  const persisted = useRef(loadPersistedTimer());

  const [timerState, setTimerState] = useState<TimerState>(
    persisted.current?.timerState ?? 'idle'
  );
  const [elapsed, setElapsed] = useState(() => {
    const p = persisted.current;
    if (!p || p.timerState === 'idle') return 0;
    if (p.timerState === 'paused') return p.accumulatedSeconds;
    // Running: compute elapsed = accumulated + (now - segmentStart)
    return p.accumulatedSeconds + Math.floor((Date.now() - p.segmentStartMs) / 1000);
  });
  const [clientId, setClientId] = useState(persisted.current?.clientId ?? '');
  const [projectId, setProjectId] = useState(persisted.current?.projectId ?? '');
  const [description, setDescription] = useState(persisted.current?.description ?? '');
  const [billable, setBillable] = useState(persisted.current?.billable ?? true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const segmentStartRef = useRef<number>(persisted.current?.segmentStartMs ?? 0);
  const accumulatedRef = useRef<number>(persisted.current?.accumulatedSeconds ?? 0);
  const originalStartRef = useRef<Date | null>(
    persisted.current?.originalStartISO
      ? new Date(persisted.current.originalStartISO)
      : null
  );

  // Filter projects by selected client
  const filteredProjects = clientId
    ? projects.filter((p) => p.client_id === clientId)
    : projects;

  // Reset project when client changes
  useEffect(() => {
    if (clientId && projectId) {
      const valid = projects.find(
        (p) => p.id === projectId && p.client_id === clientId
      );
      if (!valid) setProjectId('');
    }
  }, [clientId]);

  // ─── Persist timer state on every change ───────────────
  const persistState = useCallback(
    (state: TimerState) => {
      if (state === 'idle') {
        savePersistedTimer(null);
      } else {
        savePersistedTimer({
          timerState: state,
          originalStartISO: originalStartRef.current?.toISOString() ?? new Date().toISOString(),
          accumulatedSeconds: accumulatedRef.current,
          segmentStartMs: segmentStartRef.current,
          clientId,
          projectId,
          description,
          billable,
        });
      }
    },
    [clientId, projectId, description, billable]
  );

  // ─── Ticking helpers ──────────────────────────────────
  const startTicking = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    segmentStartRef.current = Date.now();
    intervalRef.current = setInterval(() => {
      const segmentSeconds = Math.floor(
        (Date.now() - segmentStartRef.current) / 1000
      );
      setElapsed(accumulatedRef.current + segmentSeconds);
    }, 1000);
  }, []);

  const stopTicking = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // ─── Resume ticking on mount if timer was running ──────
  useEffect(() => {
    if (persisted.current?.timerState === 'running') {
      // segmentStartRef already set from persisted, just start the interval
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => {
        const segmentSeconds = Math.floor(
          (Date.now() - segmentStartRef.current) / 1000
        );
        setElapsed(accumulatedRef.current + segmentSeconds);
      }, 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // ─── Actions ──────────────────────────────────────────
  const handleStart = useCallback(() => {
    setError('');
    originalStartRef.current = new Date();
    accumulatedRef.current = 0;
    setElapsed(0);
    setTimerState('running');
    startTicking();
    // Persist
    savePersistedTimer({
      timerState: 'running',
      originalStartISO: originalStartRef.current.toISOString(),
      accumulatedSeconds: 0,
      segmentStartMs: segmentStartRef.current,
      clientId,
      projectId,
      description,
      billable,
    });
  }, [startTicking, clientId, projectId, description, billable]);

  const handlePause = useCallback(() => {
    stopTicking();
    const segmentSeconds = Math.floor(
      (Date.now() - segmentStartRef.current) / 1000
    );
    accumulatedRef.current += segmentSeconds;
    setElapsed(accumulatedRef.current);
    setTimerState('paused');
    persistState('paused');
  }, [stopTicking, persistState]);

  const handleResume = useCallback(() => {
    setError('');
    setTimerState('running');
    startTicking();
    // Persist with new segment start
    savePersistedTimer({
      timerState: 'running',
      originalStartISO: originalStartRef.current?.toISOString() ?? new Date().toISOString(),
      accumulatedSeconds: accumulatedRef.current,
      segmentStartMs: segmentStartRef.current,
      clientId,
      projectId,
      description,
      billable,
    });
  }, [startTicking, clientId, projectId, description, billable]);

  const handleStop = useCallback(async () => {
    stopTicking();

    // Compute elapsed from refs (not React state, which may be stale)
    const now = Date.now();
    let segmentSeconds = 0;
    if (timerState === 'running' && segmentStartRef.current > 0) {
      segmentSeconds = Math.floor((now - segmentStartRef.current) / 1000);
    }
    // Use elapsed state as fallback if refs seem wrong
    const totalSeconds = Math.max(
      accumulatedRef.current + segmentSeconds,
      elapsed  // fallback: the displayed elapsed value
    );
    const durationMinutes = Math.max(1, Math.round(totalSeconds / 60));

    const endTime = new Date();
    const startTime = originalStartRef.current ?? new Date(endTime.getTime() - totalSeconds * 1000);

    // Reset timer state AFTER capturing values
    setTimerState('idle');
    savePersistedTimer(null);
    setError('');
    setSaving(true);

    try {
      const result = await api.create('time_entries', {
        date: startTime.toISOString().slice(0, 10),
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        duration_minutes: durationMinutes,
        client_id: clientId || null,
        project_id: projectId || null,
        description: description || null,
        is_billable: billable,
      });

      // IPC handler returns { error } on failure instead of throwing
      if (result && typeof result === 'object' && 'error' in result) {
        throw new Error(result.error);
      }

      // Verify result is a valid record
      if (!result || !result.id) {
        throw new Error('Entry was not created — no record returned');
      }

      // Reset form on success
      setDescription('');
      setElapsed(0);
      accumulatedRef.current = 0;
      originalStartRef.current = null;
      onEntryCreated();
    } catch (err: any) {
      const msg = err?.message || 'Failed to save time entry';
      console.error('Failed to create time entry:', msg, err);
      setError(msg);
      // Backup alert so the user never misses the error
      alert('Time entry failed to save: ' + msg);
    } finally {
      setSaving(false);
    }
  }, [timerState, elapsed, clientId, projectId, description, billable, onEntryCreated, stopTicking]);

  const handleDiscard = useCallback(() => {
    stopTicking();
    setTimerState('idle');
    setElapsed(0);
    accumulatedRef.current = 0;
    originalStartRef.current = null;
    setError('');
    savePersistedTimer(null);
  }, [stopTicking]);

  const isActive = timerState !== 'idle';

  return (
    <div className="space-y-2">
      <div
        className="block-card p-4"
        style={{
          borderLeft: `3px solid ${timerState === 'running' ? '#22c55e' : timerState === 'paused' ? '#f59e0b' : '#2e2e2e'}`,
          transition: 'border-color 0.2s',
        }}
      >
        <div className="flex items-center gap-4">
          {/* Timer Display */}
          <div className="flex items-center gap-2 min-w-[140px]">
            <Clock
              size={16}
              className={
                timerState === 'running'
                  ? 'text-accent-income'
                  : timerState === 'paused'
                  ? 'text-yellow-400'
                  : 'text-text-muted'
              }
            />
            <span
              className={`text-2xl font-mono font-bold ${
                timerState === 'running'
                  ? 'text-accent-income'
                  : timerState === 'paused'
                  ? 'text-yellow-400'
                  : 'text-text-primary'
              }`}
            >
              {formatElapsed(elapsed)}
            </span>
            {timerState === 'paused' && (
              <span className="text-[10px] font-bold text-yellow-400 uppercase tracking-wider">
                Paused
              </span>
            )}
          </div>

          {/* Description Input */}
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What are you working on?"
            className="block-input flex-1"
            disabled={isActive}
          />

          {/* Client Selector */}
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="block-select"
            style={{ width: '160px' }}
            disabled={isActive}
          >
            <option value="">No client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          {/* Project Selector */}
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="block-select"
            style={{ width: '160px' }}
            disabled={isActive}
          >
            <option value="">No project</option>
            {filteredProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          {/* Billable Toggle */}
          <button
            onClick={() => setBillable(!billable)}
            className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
              billable
                ? 'bg-accent-income-bg text-accent-income'
                : 'bg-bg-tertiary text-text-muted'
            }`}
            style={{ borderRadius: '6px', whiteSpace: 'nowrap' }}
            disabled={isActive}
            title={billable ? 'Billable' : 'Non-billable'}
          >
            $
          </button>

          {/* Action Buttons */}
          <div className="flex items-center gap-1.5">
            {timerState === 'idle' && (
              <button
                onClick={handleStart}
                className="block-btn-success flex items-center gap-1.5 px-4 py-2 text-xs font-semibold"
                style={{ borderRadius: '6px', whiteSpace: 'nowrap' }}
              >
                <Play size={14} />
                Start
              </button>
            )}

            {timerState === 'running' && (
              <>
                <button
                  onClick={handlePause}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/20 transition-colors"
                  style={{ borderRadius: '6px', whiteSpace: 'nowrap' }}
                >
                  <Pause size={14} />
                  Pause
                </button>
                <button
                  onClick={handleStop}
                  disabled={saving}
                  className="block-btn-danger flex items-center gap-1.5 px-3 py-2 text-xs font-semibold"
                  style={{ borderRadius: '6px', whiteSpace: 'nowrap', opacity: saving ? 0.6 : 1 }}
                >
                  <Square size={14} />
                  {saving ? 'Saving...' : 'Stop'}
                </button>
              </>
            )}

            {timerState === 'paused' && (
              <>
                <button
                  onClick={handleResume}
                  className="block-btn-success flex items-center gap-1.5 px-3 py-2 text-xs font-semibold"
                  style={{ borderRadius: '6px', whiteSpace: 'nowrap' }}
                >
                  <Play size={14} />
                  Resume
                </button>
                <button
                  onClick={handleStop}
                  disabled={saving}
                  className="block-btn-danger flex items-center gap-1.5 px-3 py-2 text-xs font-semibold"
                  style={{ borderRadius: '6px', whiteSpace: 'nowrap', opacity: saving ? 0.6 : 1 }}
                >
                  <Square size={14} />
                  {saving ? 'Saving...' : 'Stop'}
                </button>
                <button
                  onClick={handleDiscard}
                  className="block-btn px-3 py-2 text-xs font-semibold text-text-muted hover:text-text-primary"
                  style={{ borderRadius: '6px', whiteSpace: 'nowrap' }}
                  title="Discard this timer without saving"
                >
                  Discard
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div
          className="flex items-center gap-2 px-4 py-2.5 text-xs text-accent-expense bg-accent-expense/10 border border-accent-expense/20"
          style={{ borderRadius: '6px' }}
        >
          <AlertCircle size={14} className="flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            onClick={() => setError('')}
            className="text-accent-expense/60 hover:text-accent-expense transition-colors text-xs font-bold"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
};

export default TimerWidget;
