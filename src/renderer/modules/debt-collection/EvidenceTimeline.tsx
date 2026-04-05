import React, { useEffect, useState, useCallback } from 'react';
import { Plus, Paperclip, FileDown } from 'lucide-react';
import api from '../../lib/api';
import { formatDate } from '../../lib/format';

// ─── Types ──────────────────────────────────────────────
interface EvidenceItem {
  id: string;
  type: string;
  title: string;
  description: string;
  date_of_evidence: string;
  court_relevance: string;
  file_path: string;
  file_name: string;
  notes: string;
  created_at: string;
}

interface EvidenceTimelineProps {
  debtId: string;
  onAdd: () => void;
  onEdit: (id: string) => void;
}

// ─── Color mapping by type ──────────────────────────────
const TYPE_DOT_COLORS: Record<string, string> = {
  contract:          'bg-accent-blue',
  invoice:           'bg-accent-blue',
  communication:     'bg-amber-500',
  payment_record:    'bg-emerald-500',
  delivery_proof:    'bg-emerald-500',
  signed_agreement:  'bg-accent-blue',
  witness_statement: 'bg-red-500',
  photo:             'bg-purple-500',
  other:             'bg-gray-500',
};

const RELEVANCE_STYLES: Record<string, string> = {
  high:   'bg-red-500/20 text-red-400',
  medium: 'bg-amber-500/20 text-amber-400',
  low:    'bg-accent-blue/20 text-accent-blue',
};

function typeLabel(type: string): string {
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ─── PDF export HTML builder ────────────────────────────
function buildTimelineHTML(items: EvidenceItem[]): string {
  const rows = items
    .map(
      (item) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #333;">${item.date_of_evidence ? new Date(item.date_of_evidence).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #333;">${typeLabel(item.type)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #333;font-weight:600;">${item.title}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #333;">${item.description || '—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #333;text-transform:capitalize;">${item.court_relevance || '—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #333;">${item.file_name || '—'}</td>
    </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Evidence Timeline</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #fff; color: #111; margin: 24px; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    p.meta { color: #666; font-size: 12px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 8px 12px; border-bottom: 2px solid #222; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #555; }
    td { vertical-align: top; }
  </style>
</head>
<body>
  <h1>Evidence Timeline</h1>
  <p class="meta">Generated ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} &mdash; ${items.length} item${items.length !== 1 ? 's' : ''}</p>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Type</th>
        <th>Title</th>
        <th>Description</th>
        <th>Relevance</th>
        <th>File</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

// ─── Component ──────────────────────────────────────────
const EvidenceTimeline: React.FC<EvidenceTimelineProps> = ({ debtId, onAdd, onEdit }) => {
  const [items, setItems] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const rows = await api.query(
        'debt_evidence',
        { debt_id: debtId },
        { field: 'date_of_evidence', dir: 'asc' }
      );
      if (Array.isArray(rows)) setItems(rows as EvidenceItem[]);
    } catch (err) {
      console.error('Failed to load evidence:', err);
    } finally {
      setLoading(false);
    }
  }, [debtId]);

  useEffect(() => { load(); }, [load]);

  const handleExport = async () => {
    if (items.length === 0) return;
    try {
      await api.saveToPDF(buildTimelineHTML(items), 'Evidence Timeline');
    } catch (err) {
      console.error('Failed to export timeline:', err);
    }
  };

  if (loading) {
    return (
      <div className="block-card">
        <div className="flex items-center justify-center py-8 text-text-muted text-sm">
          Loading evidence...
        </div>
      </div>
    );
  }

  return (
    <div className="block-card">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-bold text-text-primary uppercase tracking-wider">
          Evidence Timeline
        </h4>
        <button
          className="block-btn flex items-center gap-1.5 text-xs"
          onClick={onAdd}
        >
          <Plus size={14} />
          Add Evidence
        </button>
      </div>

      {/* Empty state */}
      {items.length === 0 && (
        <p className="text-text-muted text-sm py-6 text-center">
          No evidence items. Add evidence to build your case.
        </p>
      )}

      {/* Evidence list */}
      {items.length > 0 && (
        <div className="space-y-0">
          {items.map((item) => {
            const dotColor = TYPE_DOT_COLORS[item.type] || 'bg-gray-500';
            const relStyle = RELEVANCE_STYLES[item.court_relevance] || RELEVANCE_STYLES.low;

            return (
              <button
                key={item.id}
                onClick={() => onEdit(item.id)}
                className="w-full text-left flex items-start gap-3 px-3 py-3 hover:bg-bg-tertiary transition-colors border-b border-border-primary last:border-b-0"
                style={{ borderRadius: '2px' }}
              >
                {/* Color dot */}
                <div
                  className={`w-2.5 h-2.5 mt-1.5 flex-shrink-0 ${dotColor}`}
                  style={{ borderRadius: '2px' }}
                />

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-text-muted">
                      {formatDate(item.date_of_evidence)}
                    </span>
                    <span
                      className="block-badge text-[10px] px-1.5 py-0.5"
                      style={{ borderRadius: '2px' }}
                    >
                      {typeLabel(item.type)}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 font-semibold ${relStyle}`}
                      style={{ borderRadius: '2px' }}
                    >
                      {item.court_relevance}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-text-primary mt-0.5 truncate">
                    {item.title}
                  </p>
                  {item.description && (
                    <p className="text-xs text-text-muted mt-0.5 truncate">
                      {item.description}
                    </p>
                  )}
                </div>

                {/* File indicator */}
                {item.file_path && (
                  <Paperclip size={14} className="text-text-muted flex-shrink-0 mt-1" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Export button */}
      {items.length > 0 && (
        <div className="mt-4 pt-3 border-t border-border-primary">
          <button
            className="block-btn flex items-center gap-1.5 text-xs"
            onClick={handleExport}
          >
            <FileDown size={14} />
            Export Timeline
          </button>
        </div>
      )}
    </div>
  );
};

export default EvidenceTimeline;
