import React, { useEffect, useState, useMemo } from 'react';
import {
  FileText, Upload, Search, Filter, Eye, File, Image, FileSpreadsheet,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

// ─── Types ──────────────────────────────────────────────
interface Document {
  id: string;
  filename: string;
  entity_type: string;
  entity_id: string;
  entity_name?: string;
  tags: string;
  file_size: number;
  mime_type: string;
  file_path: string;
  uploaded_at: string;
  created_at: string;
}

type EntityFilter = '' | 'client' | 'invoice' | 'expense' | 'project';

// ─── Helpers ────────────────────────────────────────────
const formatFileSize = (bytes: number): string => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

const getFileIcon = (mime: string) => {
  if (mime?.startsWith('image/')) return Image;
  if (mime?.includes('spreadsheet') || mime?.includes('csv')) return FileSpreadsheet;
  return File;
};

const entityBadgeClass: Record<string, string> = {
  client: 'block-badge block-badge-blue',
  invoice: 'block-badge block-badge-income',
  expense: 'block-badge block-badge-expense',
  project: 'block-badge block-badge-purple',
};

// ─── Component ──────────────────────────────────────────
const Documents: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [entityFilter, setEntityFilter] = useState<EntityFilter>('');
  const [previewDoc, setPreviewDoc] = useState<Document | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      try {
        // Bug fix #15: was fetching all companies' documents — scoped to active company.
        const rows = await api.query('documents', { company_id: activeCompany.id });
        if (!cancelled) setDocuments(Array.isArray(rows) ? rows : []);
      } catch (err) {
        console.error('Failed to load documents:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeCompany]);

  const handleUpload = async () => {
    try {
      const file = await api.openFileDialog();
      if (!file) return; // user cancelled

      const mimeType = file.name.endsWith('.pdf') ? 'application/pdf'
        : file.name.endsWith('.png') ? 'image/png'
        : file.name.endsWith('.jpg') || file.name.endsWith('.jpeg') ? 'image/jpeg'
        : file.name.endsWith('.csv') ? 'text/csv'
        : file.name.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/octet-stream';

      const doc = await api.create('documents', {
        filename: file.name,
        file_path: file.path,
        file_size: file.size,
        mime_type: mimeType,
        entity_type: '',
        entity_id: '',
        tags: '',
        uploaded_at: new Date().toISOString(),
      });

      setDocuments((prev) => [doc, ...prev]);
    } catch (err) {
      console.error('Failed to upload document:', err);
    }
  };

  const filtered = useMemo(() => {
    return documents.filter((doc) => {
      if (search) {
        const q = search.toLowerCase();
        const match =
          doc.filename?.toLowerCase().includes(q) ||
          doc.tags?.toLowerCase().includes(q) ||
          doc.entity_name?.toLowerCase().includes(q);
        if (!match) return false;
      }
      if (entityFilter && doc.entity_type !== entityFilter) return false;
      return true;
    });
  }, [documents, search, entityFilter]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">
        Loading documents...
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      {/* Header */}
      <div className="module-header">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary"
            style={{ borderRadius: '2px' }}
          >
            <FileText size={18} className="text-accent-blue" />
          </div>
          <div>
            <h2 className="module-title text-text-primary">Documents</h2>
            <p className="text-xs text-text-muted mt-0.5">
              {filtered.length} document{filtered.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <button className="block-btn-primary flex items-center gap-2" onClick={handleUpload}>
          <Upload size={16} />
          Upload
        </button>
      </div>

      {/* Filters */}
      <div className="block-card p-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Search documents..."
              className="block-input pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-text-muted" />
            <select
              className="block-select"
              style={{ width: 'auto', minWidth: '150px' }}
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value as EntityFilter)}
            >
              <option value="">All Entity Types</option>
              <option value="client">Client</option>
              <option value="invoice">Invoice</option>
              <option value="expense">Expense</option>
              <option value="project">Project</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <FileText size={24} className="text-text-muted" />
          </div>
          <p className="text-sm text-text-secondary font-medium">No documents found</p>
          <p className="text-xs text-text-muted mt-1">
            Upload your first document or adjust the filters above.
          </p>
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden">
          <table className="block-table">
            <thead>
              <tr>
                <th>Filename</th>
                <th>Entity Type</th>
                <th>Entity</th>
                <th>Tags</th>
                <th className="text-right">Size</th>
                <th>Uploaded</th>
                <th className="text-center">Preview</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((doc) => {
                const FileIcon = getFileIcon(doc.mime_type);
                return (
                  <tr key={doc.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <FileIcon size={16} className="text-text-muted shrink-0" />
                        <span className="text-text-primary font-medium">{doc.filename}</span>
                      </div>
                    </td>
                    <td>
                      {doc.entity_type ? (
                        <span className={entityBadgeClass[doc.entity_type] || 'block-badge'}>
                          {doc.entity_type}
                        </span>
                      ) : (
                        <span className="text-text-muted">-</span>
                      )}
                    </td>
                    <td className="text-text-secondary">
                      {doc.entity_name || doc.entity_id || '-'}
                    </td>
                    <td>
                      {doc.tags ? (
                        <div className="flex flex-wrap gap-1">
                          {doc.tags.split(',').map((tag, i) => (
                            <span key={i} className="block-badge block-badge-purple text-[10px]">
                              {tag.trim()}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-text-muted">-</span>
                      )}
                    </td>
                    <td className="text-right font-mono text-text-secondary text-xs">
                      {formatFileSize(doc.file_size)}
                    </td>
                    <td className="font-mono text-text-secondary text-xs">
                      {doc.uploaded_at || doc.created_at
                        ? format(parseISO(doc.uploaded_at || doc.created_at), 'MMM d, yyyy')
                        : '-'}
                    </td>
                    <td className="text-center">
                      <button
                        className="text-text-muted hover:text-accent-blue transition-colors"
                        onClick={() => setPreviewDoc(doc)}
                        title="Preview document"
                      >
                        <Eye size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Preview Modal */}
      {previewDoc && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => setPreviewDoc(null)}
        >
          <div
            className="block-card-elevated w-full max-w-lg space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-primary">Document Preview</h3>
              <button
                className="text-text-muted hover:text-text-primary"
                onClick={() => setPreviewDoc(null)}
              >
                <Eye size={16} />
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-text-muted">Filename</span>
                <span className="text-text-primary font-medium">{previewDoc.filename}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Type</span>
                <span className="text-text-secondary">{previewDoc.mime_type || 'Unknown'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Size</span>
                <span className="text-text-secondary font-mono">
                  {formatFileSize(previewDoc.file_size)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Entity</span>
                <span className="text-text-secondary">
                  {previewDoc.entity_type
                    ? `${previewDoc.entity_type}: ${previewDoc.entity_name || previewDoc.entity_id}`
                    : 'Unattached'}
                </span>
              </div>
              {previewDoc.tags && (
                <div className="flex justify-between">
                  <span className="text-text-muted">Tags</span>
                  <span className="text-text-secondary">{previewDoc.tags}</span>
                </div>
              )}
            </div>
            <div className="bg-bg-tertiary border border-border-primary p-8 text-center">
              <FileText size={48} className="mx-auto text-text-muted mb-2" />
              <p className="text-xs text-text-muted">
                Full document preview will be available in a future update.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      {filtered.length > 0 && (
        <div className="text-xs text-text-muted">
          Showing {filtered.length} of {documents.length} document{documents.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
};

export default Documents;
