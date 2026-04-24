import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

// ─── Types ──────────────────────────────────────────────
interface Client {
  id: string;
  name: string;
}

interface ProjectFormData {
  name: string;
  client_id: string;
  description: string;
  status: string;
  budget: string;
  budget_type: string;
  hourly_rate: string;
  start_date: string;
  end_date: string;
  tags: string;
}

interface ProjectFormProps {
  projectId?: string | null;
  onClose: () => void;
  onSaved: () => void;
}

const INITIAL_FORM: ProjectFormData = {
  name: '',
  client_id: '',
  description: '',
  status: 'active',
  budget: '',
  budget_type: 'fixed',
  hourly_rate: '',
  start_date: '',
  end_date: '',
  tags: '',
};

function parseOptionalFloat(value: string): number | null {
  if (value.trim() === '') return null;
  const n = parseFloat(value);
  return isNaN(n) ? null : n;
}

// ─── Component ──────────────────────────────────────────
const ProjectForm: React.FC<ProjectFormProps> = ({ projectId, onClose, onSaved }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [form, setForm] = useState<ProjectFormData>(INITIAL_FORM);
  const [clients, setClients] = useState<Client[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isEdit = Boolean(projectId);

  // ─── Load clients & existing project ──────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      try {
        const clientRows = await api.query('clients', { company_id: activeCompany.id });
        if (!cancelled && Array.isArray(clientRows)) {
          setClients(clientRows);
        }

        if (projectId) {
          const project = await api.get('projects', projectId);
          if (!cancelled && project) {
            setForm({
              name: project.name ?? '',
              client_id: project.client_id ?? '',
              description: project.description ?? '',
              status: project.status ?? 'active',
              budget: project.budget != null ? String(project.budget) : '',
              budget_type: project.budget_type ?? 'fixed',
              hourly_rate: project.hourly_rate != null ? String(project.hourly_rate) : '',
              start_date: project.start_date ?? '',
              end_date: project.end_date ?? '',
              tags: project.tags ?? '',
            });
          }
        }
      } catch (err) {
        console.error('Failed to load form data:', err);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [projectId, activeCompany]);

  // ─── Field Handlers ───────────────────────────────
  const set = (field: keyof ProjectFormData, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError('');
  };

  // ─── Submit ───────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.name.trim()) {
      setError('Project name is required.');
      return;
    }

    if (form.budget.trim() !== '' && isNaN(parseFloat(form.budget))) {
      setError('Budget must be a valid number.');
      return;
    }

    if (form.hourly_rate.trim() !== '' && isNaN(parseFloat(form.hourly_rate))) {
      setError('Hourly rate must be a valid number.');
      return;
    }

    if (form.start_date && form.end_date && form.start_date > form.end_date) {
      setError('End date must be on or after start date.');
      return;
    }

    if (form.budget.trim() !== '' && parseFloat(form.budget) < 0) {
      setError('Budget cannot be negative.');
      return;
    }

    if (form.hourly_rate.trim() !== '' && parseFloat(form.hourly_rate) < 0) {
      setError('Hourly rate cannot be negative.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const budgetVal = parseOptionalFloat(form.budget);
      const rateVal = parseOptionalFloat(form.hourly_rate);
      const payload = {
        name: form.name.trim(),
        client_id: form.client_id || null,
        description: form.description.trim(),
        status: form.status,
        budget: budgetVal !== null ? budgetVal : 0,
        budget_type: form.budget_type,
        hourly_rate: rateVal !== null ? rateVal : 0,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        tags: form.tags.trim(),
      };

      if (isEdit && projectId) {
        await api.update('projects', projectId, payload);
      } else {
        await api.create('projects', payload);
      }

      onSaved();
    } catch (err: any) {
      console.error('Failed to save project:', err);
      setError(err?.message ?? 'Failed to save project.');
    } finally {
      setSaving(false);
    }
  };

  // ─── Render ───────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-bg-secondary border border-border-primary w-full max-w-lg max-h-[90vh] overflow-y-auto"
        style={{ borderRadius: '6px' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-primary">
          <h2 className="text-sm font-bold text-text-primary">
            {isEdit ? 'Edit Project' : 'New Project'}
          </h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div
              className="text-xs text-accent-expense bg-accent-expense/10 px-3 py-2 border border-accent-expense/20"
              style={{ borderRadius: '6px' }}
            >
              {error}
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
              Project Name *
            </label>
            <input
              className="block-input"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Enter project name"
            />
          </div>

          {/* Client */}
          <div>
            <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
              Client
            </label>
            <select
              className="block-select"
              value={form.client_id}
              onChange={(e) => set('client_id', e.target.value)}
            >
              <option value="">-- No Client --</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div>
            <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
              Description
            </label>
            <textarea
              className="block-input"
              rows={3}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Project description..."
              style={{ resize: 'vertical' }}
            />
          </div>

          {/* Status */}
          <div>
            <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
              Status
            </label>
            <select
              className="block-select"
              value={form.status}
              onChange={(e) => set('status', e.target.value)}
            >
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="on_hold">On Hold</option>
              <option value="archived">Archived</option>
            </select>
          </div>

          {/* Budget Row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
                Budget
              </label>
              <input
                className="block-input font-mono"
                type="number"
                min="0"
                step="0.01"
                value={form.budget}
                onChange={(e) => set('budget', e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
                Budget Type
              </label>
              <select
                className="block-select"
                value={form.budget_type}
                onChange={(e) => set('budget_type', e.target.value)}
              >
                <option value="fixed">Fixed</option>
                <option value="hourly">Hourly</option>
                <option value="none">None</option>
              </select>
            </div>
          </div>

          {/* Hourly Rate */}
          <div>
            <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
              Hourly Rate
            </label>
            <input
              className="block-input font-mono"
              type="number"
              min="0"
              step="0.01"
              value={form.hourly_rate}
              onChange={(e) => set('hourly_rate', e.target.value)}
              placeholder="0.00"
            />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
                Start Date
              </label>
              <input
                className="block-input"
                type="date"
                value={form.start_date}
                onChange={(e) => set('start_date', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
                End Date
              </label>
              <input
                className="block-input"
                type="date"
                value={form.end_date}
                onChange={(e) => set('end_date', e.target.value)}
              />
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
              Tags
            </label>
            <input
              className="block-input"
              value={form.tags}
              onChange={(e) => set('tags', e.target.value)}
              placeholder="Comma-separated tags"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              className="block-btn"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="block-btn-primary"
              disabled={saving}
            >
              {saving ? 'Saving...' : isEdit ? 'Update Project' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ProjectForm;
