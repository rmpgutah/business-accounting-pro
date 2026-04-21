import React, { useState, useEffect, useCallback } from 'react';
import { Plus } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import TimerWidget from './TimerWidget';
import TimeEntryList from './TimeEntryList';
import TimeEntryForm from './TimeEntryForm';
import WeeklySummary from './WeeklySummary';

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

// ─── Helpers ────────────────────────────────────────────
function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  // Adjust so Monday = 0
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function weekDateRange(weekStart: Date): { start: string; end: string } {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  return {
    start: weekStart.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

// ─── Component ──────────────────────────────────────────
const TimeTracking: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);

  // Load clients and projects once
  useEffect(() => {
    const loadRefs = async () => {
      if (!activeCompany) return;
      try {
        const [clientData, projectData] = await Promise.all([
          api.query('clients', { company_id: activeCompany.id }),
          api.query('projects', { company_id: activeCompany.id }),
        ]);
        if (Array.isArray(clientData)) setClients(clientData);
        if (Array.isArray(projectData)) setProjects(projectData);
      } catch (err) {
        console.error('Failed to load clients/projects:', err);
      }
    };
    loadRefs();
  }, [activeCompany]);

  // Load entries for current week
  const loadEntries = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    const { start, end } = weekDateRange(weekStart);
    try {
      const data = await api.rawQuery(
        'SELECT * FROM time_entries WHERE company_id = ? AND date >= ? AND date <= ? ORDER BY date DESC',
        [activeCompany.id, start, end]
      );
      if (Array.isArray(data)) {
        setEntries(data);
      }
    } catch (err) {
      console.error('Failed to load time entries:', err);
    } finally {
      setLoading(false);
    }
  }, [weekStart, activeCompany]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const handlePrevWeek = () => {
    setWeekStart((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() - 7);
      return d;
    });
  };

  const handleNextWeek = () => {
    setWeekStart((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + 7);
      return d;
    });
  };

  const handleEdit = (entry: TimeEntry) => {
    setEditingEntry(entry);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await api.remove('time_entries', id);
      loadEntries();
    } catch (err: any) {
      console.error('Failed to delete time entry:', err);
      alert('Operation failed: ' + (err?.message || 'Unknown error'));
    }
  };

  const handleFormClose = () => {
    setShowForm(false);
    setEditingEntry(null);
  };

  const handleManualEntry = () => {
    setEditingEntry(null);
    setShowForm(true);
  };

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      {/* Header */}
      <div className="module-header">
        <h1 className="module-title text-text-primary">Time Tracking</h1>
        <div className="module-actions">
          <button
            onClick={handleManualEntry}
            className="block-btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
            style={{ borderRadius: '6px' }}
          >
            <Plus size={14} />
            Manual Entry
          </button>
        </div>
      </div>

      {/* Timer Widget */}
      <TimerWidget
        clients={clients}
        projects={projects}
        onEntryCreated={loadEntries}
      />

      {/* Main Content: List + Summary */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <span className="text-text-muted text-sm font-mono">
            Loading time entries...
          </span>
        </div>
      ) : (
        <div className="flex gap-5 items-start">
          {/* Time Entry List — main area */}
          <TimeEntryList
            entries={entries}
            clients={clients}
            projects={projects}
            weekStart={weekStart}
            onPrevWeek={handlePrevWeek}
            onNextWeek={handleNextWeek}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />

          {/* Weekly Summary — right side */}
          <WeeklySummary entries={entries} weekStart={weekStart} />
        </div>
      )}

      {/* Modal Form */}
      {showForm && (
        <TimeEntryForm
          entry={editingEntry}
          clients={clients}
          projects={projects}
          onClose={handleFormClose}
          onSaved={loadEntries}
        />
      )}
    </div>
  );
};

export default TimeTracking;
