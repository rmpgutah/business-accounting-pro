import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Square, Clock } from 'lucide-react';
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
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [clientId, setClientId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [description, setDescription] = useState('');
  const [billable, setBillable] = useState(true);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<Date | null>(null);

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

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const handleStart = useCallback(() => {
    startTimeRef.current = new Date();
    setElapsed(0);
    setRunning(true);

    intervalRef.current = setInterval(() => {
      if (!startTimeRef.current) return;
      const diff = Math.floor(
        (Date.now() - startTimeRef.current.getTime()) / 1000
      );
      setElapsed(diff);
    }, 1000);
  }, []);

  const handleStop = useCallback(async () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setRunning(false);

    const endTime = new Date();
    const startTime = startTimeRef.current ?? new Date(endTime.getTime() - elapsed * 1000);
    const durationMinutes = Math.round(
      (endTime.getTime() - startTime.getTime()) / 60000
    );

    if (durationMinutes < 1) return;

    try {
      await api.create('time_entries', {
        date: startTime.toISOString().slice(0, 10),
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        duration_minutes: durationMinutes,
        client_id: clientId || null,
        project_id: projectId || null,
        description: description || null,
        is_billable: billable,
      });

      // Reset form
      setDescription('');
      setElapsed(0);
      startTimeRef.current = null;
      onEntryCreated();
    } catch (err) {
      console.error('Failed to create time entry:', err);
    }
  }, [elapsed, clientId, projectId, description, billable, onEntryCreated]);

  return (
    <div
      className="block-card p-4"
      style={{
        borderLeft: `3px solid ${running ? '#22c55e' : '#2e2e2e'}`,
        transition: 'border-color 0.2s',
      }}
    >
      <div className="flex items-center gap-4">
        {/* Timer Display */}
        <div className="flex items-center gap-2 min-w-[140px]">
          <Clock
            size={16}
            className={running ? 'text-accent-income' : 'text-text-muted'}
          />
          <span
            className={`text-2xl font-mono font-bold ${
              running ? 'text-accent-income' : 'text-text-primary'
            }`}
          >
            {formatElapsed(elapsed)}
          </span>
        </div>

        {/* Description Input */}
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What are you working on?"
          className="block-input flex-1"
          disabled={running}
        />

        {/* Client Selector */}
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="block-select"
          style={{ width: '160px' }}
          disabled={running}
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
          disabled={running}
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
          style={{ borderRadius: '2px', whiteSpace: 'nowrap' }}
          disabled={running}
          title={billable ? 'Billable' : 'Non-billable'}
        >
          $
        </button>

        {/* Start / Stop Button */}
        {running ? (
          <button
            onClick={handleStop}
            className="block-btn-danger flex items-center gap-1.5 px-4 py-2 text-xs font-semibold"
            style={{ borderRadius: '2px', whiteSpace: 'nowrap' }}
          >
            <Square size={14} />
            Stop
          </button>
        ) : (
          <button
            onClick={handleStart}
            className="block-btn-success flex items-center gap-1.5 px-4 py-2 text-xs font-semibold"
            style={{ borderRadius: '2px', whiteSpace: 'nowrap' }}
          >
            <Play size={14} />
            Start
          </button>
        )}
      </div>
    </div>
  );
};

export default TimerWidget;
