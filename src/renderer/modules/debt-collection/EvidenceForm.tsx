import React, { useEffect, useState } from 'react';
import { X, Paperclip } from 'lucide-react';
import api from '../../lib/api';
import ErrorBanner from '../../components/ErrorBanner';

// ─── Types ──────────────────────────────────────────────
interface EvidenceFormData {
  type: string;
  title: string;
  description: string;
  date_of_evidence: string;
  court_relevance: string;
  file_path: string;
  file_name: string;
  notes: string;
}

interface EvidenceFormProps {
  debtId: string;
  evidenceId?: string | null;
  onClose: () => void;
  onSaved: () => void;
}

function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const emptyForm: EvidenceFormData = {
  type: 'contract',
  title: '',
  description: '',
  date_of_evidence: todayISO(),
  court_relevance: 'medium',
  file_path: '',
  file_name: '',
  notes: '',
};

// ─── Component ──────────────────────────────────────────
const EvidenceForm: React.FC<EvidenceFormProps> = ({ debtId, evidenceId, onClose, onSaved }) => {
  const [form, setForm] = useState<EvidenceFormData>({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!!evidenceId);
  const [error, setError] = useState('');

  // ── Load existing record for edit ──
  useEffect(() => {
    if (!evidenceId) return;
    let cancelled = false;
    const load = async () => {
      setError('');
      try {
        const row = await api.get('debt_evidence', evidenceId);
        if (row && !cancelled) {
          setForm({
            type: row.type || 'contract',
            title: row.title || '',
            description: row.description || '',
            date_of_evidence: row.date_of_evidence ? row.date_of_evidence.slice(0, 10) : todayISO(),
            court_relevance: row.court_relevance || 'medium',
            file_path: row.file_path || '',
            file_name: row.file_name || '',
            notes: row.notes || '',
          });
        }
      } catch (err: any) {
        console.error('Failed to load evidence:', err);
        if (!cancelled) setError(err?.message || 'Failed to load evidence');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [evidenceId]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleAttachFile = async () => {
    try {
      const result = await api.openFileDialog();
      if (result && !result.canceled && result.filePaths?.length > 0) {
        const fullPath = result.filePaths[0];
        const fileName = fullPath.split(/[\\/]/).pop() || fullPath;
        setForm((prev) => ({ ...prev, file_path: fullPath, file_name: fileName }));
      }
    } catch (err) {
      console.error('File dialog error:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !form.title.trim()) return;
    setSaving(true);

    const payload = {
      debt_id: debtId,
      type: form.type,
      title: form.title.trim(),
      description: form.description || null,
      date_of_evidence: form.date_of_evidence || null,
      court_relevance: form.court_relevance,
      file_path: form.file_path || null,
      file_name: form.file_name || null,
      notes: form.notes || null,
    };

    try {
      if (evidenceId) {
        await api.update('debt_evidence', evidenceId, payload);
      } else {
        await api.create('debt_evidence', payload);
      }
      onSaved();
    } catch (err: any) {
      console.error('Failed to save evidence:', err);
      alert('Failed to save evidence: ' + (err?.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/60 z-40"
        onClick={onClose}
        role="presentation"
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="block-card-elevated w-full max-w-[600px] max-h-[90vh] overflow-y-auto cursor-pointer"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-5 pb-4 border-b border-border-primary">
            <h3 className="text-base font-bold text-text-primary">
              {evidenceId ? 'Edit Evidence' : 'Add Evidence'}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors"
              style={{ borderRadius: '6px' }}
            >
              <X size={16} />
            </button>
          </div>

          {error && <ErrorBanner message={error} title="Failed to load evidence" onDismiss={() => setError('')} />}
          {loading ? (
            <div className="flex items-center justify-center py-12 text-text-muted text-sm">
              Loading...
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Type & Court Relevance — 2-column */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                    Type
                  </label>
                  <select
                    name="type"
                    className="block-select"
                    value={form.type}
                    onChange={handleChange}
                  >
                    <option value="contract">Contract</option>
                    <option value="invoice">Invoice</option>
                    <option value="communication">Communication</option>
                    <option value="payment_record">Payment Record</option>
                    <option value="delivery_proof">Delivery Proof</option>
                    <option value="signed_agreement">Signed Agreement</option>
                    <option value="witness_statement">Witness Statement</option>
                    <option value="photo">Photo</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                    Court Relevance
                  </label>
                  <select
                    name="court_relevance"
                    className="block-select"
                    value={form.court_relevance}
                    onChange={handleChange}
                  >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>

              {/* Title — full-width */}
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Title <span className="text-accent-expense">*</span>
                </label>
                <input
                  type="text"
                  name="title"
                  className="block-input"
                  placeholder="Evidence title"
                  value={form.title}
                  onChange={handleChange}
                  autoFocus
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Description
                </label>
                <textarea
                  name="description"
                  className="block-input"
                  rows={4}
                  placeholder="Describe the evidence..."
                  value={form.description}
                  onChange={handleChange}
                  style={{ resize: 'vertical' }}
                />
              </div>

              {/* Date of Evidence */}
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Date of Evidence
                </label>
                <input
                  type="date"
                  name="date_of_evidence"
                  className="block-input"
                  value={form.date_of_evidence}
                  onChange={handleChange}
                />
              </div>

              {/* Attach File */}
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Attached File
                </label>
                <button
                  type="button"
                  className="block-btn flex items-center gap-2"
                  onClick={handleAttachFile}
                >
                  <Paperclip size={14} />
                  Attach File
                </button>
                {form.file_name && (
                  <p className="mt-1.5 text-xs text-text-secondary flex items-center gap-1.5">
                    <Paperclip size={12} className="text-accent-blue" />
                    {form.file_name}
                  </p>
                )}
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Notes
                </label>
                <textarea
                  name="notes"
                  className="block-input"
                  rows={3}
                  placeholder="Additional notes..."
                  value={form.notes}
                  onChange={handleChange}
                  style={{ resize: 'vertical' }}
                />
              </div>

              {/* Footer Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t border-border-primary">
                <button type="button" className="block-btn" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="block-btn-primary"
                  disabled={saving || !form.title.trim()}
                >
                  {saving ? 'Saving...' : evidenceId ? 'Update' : 'Save'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
};

export default EvidenceForm;
