import React, { useEffect, useState, useMemo } from 'react';
import {
  FileText, Upload, Search, Filter, Eye, File, Image, FileSpreadsheet, Pencil, Trash2, X,
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
  const [editingDoc, setEditingDoc] = useState<Document | null>(null);
  const [editForm, setEditForm] = useState({ entity_type: '', tags: '' });
  const [editSaving, setEditSaving] = useState(false);
  type DocSortField = 'filename' | 'entity_type' | 'file_size' | 'uploaded_at';
  type DocSortDir = 'asc' | 'desc';
  const [sortField, setSortField] = useState<DocSortField>('uploaded_at');
  const [sortDir, setSortDir] = useState<DocSortDir>('desc');
  const [opSuccess, setOpSuccess] = useState('');
  const [opError, setOpError] = useState('');

  const handleDocSort = (f: DocSortField) => { if (sortField === f) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortField(f); setSortDir('asc'); } };

  const loadDocuments = async () => {
    if (!activeCompany) return;
    try {
      const rows = await api.query('documents', { company_id: activeCompany.id }, { field: 'uploaded_at', dir: 'desc' });
      setDocuments(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.error('Failed to load documents:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocuments();
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
      setOpSuccess('Document uploaded'); setTimeout(() => setOpSuccess(''), 3000);
    } catch (err: any) {
      console.error('Failed to upload document:', err);
      setOpError('Failed to upload: ' + (err?.message || 'Unknown error')); setTimeout(() => setOpError(''), 5000);
    }
  };

  const handleEditDoc = (doc: Document) => {
    setEditingDoc(doc);
    setEditForm({ entity_type: doc.entity_type || '', tags: doc.tags || '' });
  };

  const handleSaveEdit = async () => {
    if (!editingDoc) return;
    setEditSaving(true);
    try {
      await api.update('documents', editingDoc.id, {
        entity_type: editForm.entity_type,
        tags: editForm.tags,
      });
      setEditingDoc(null);
      await loadDocuments();
      setOpSuccess('Document updated'); setTimeout(() => setOpSuccess(''), 3000);
    } catch (err: any) {
      console.error('Failed to update document:', err);
      setOpError('Failed to update: ' + (err?.message || 'Unknown error')); setTimeout(() => setOpError(''), 5000);
    } finally {
      setEditSaving(false);
    }
  };

  const handleDeleteDoc = async (id: string) => {
    if (!window.confirm('Delete this document?')) return;
    try {
      await api.remove('documents', id);
      await loadDocuments();
      setOpSuccess('Document deleted'); setTimeout(() => setOpSuccess(''), 3000);
    } catch (err: any) {
      console.error('Failed to delete document:', err);
      setOpError('Failed to delete: ' + (err?.message || 'Unknown error')); setTimeout(() => setOpError(''), 5000);
    }
  };

  const filtered = useMemo(() => {
    let list = documents.filter((doc) => {
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
    list.sort((a, b) => {
      const aVal = (a as any)[sortField] ?? '';
      const bVal = (b as any)[sortField] ?? '';
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [documents, search, entityFilter, sortField, sortDir]);

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
            style={{ borderRadius: '6px' }}
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

      {/* Feedback */}
      {opSuccess && <div className="text-xs text-accent-income bg-accent-income/10 px-3 py-2 border border-accent-income/20" style={{ borderRadius: '6px' }}>{opSuccess}</div>}
      {opError && <div className="text-xs text-accent-expense bg-accent-expense/10 px-3 py-2 border border-accent-expense/20" style={{ borderRadius: '6px' }}>{opError}</div>}

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
          <button className="block-btn-primary mt-3 flex items-center gap-2" onClick={handleUpload}>
            <Upload size={14} /> Upload Document
          </button>
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden">
          <table className="block-table">
            <thead>
              <tr>
                <th className="cursor-pointer select-none" onClick={() => handleDocSort('filename')} role="button" tabIndex={0}><span className="inline-flex items-center gap-1">Filename {sortField === 'filename' && (sortDir === 'asc' ? '↑' : '↓')}</span></th>
                <th className="cursor-pointer select-none" onClick={() => handleDocSort('entity_type')} role="button" tabIndex={0}><span className="inline-flex items-center gap-1">Entity Type {sortField === 'entity_type' && (sortDir === 'asc' ? '↑' : '↓')}</span></th>
                <th>Entity</th>
                <th>Tags</th>
                <th className="text-right cursor-pointer select-none" onClick={() => handleDocSort('file_size')} role="button" tabIndex={0}><span className="inline-flex items-center gap-1">Size {sortField === 'file_size' && (sortDir === 'asc' ? '↑' : '↓')}</span></th>
                <th className="cursor-pointer select-none" onClick={() => handleDocSort('uploaded_at')} role="button" tabIndex={0}><span className="inline-flex items-center gap-1">Uploaded {sortField === 'uploaded_at' && (sortDir === 'asc' ? '↑' : '↓')}</span></th>
                <th className="text-center">Actions</th>
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
                      <div className="flex items-center justify-center gap-1">
                        <button
                          className="text-text-muted hover:text-accent-blue transition-colors p-1"
                          onClick={() => setPreviewDoc(doc)}
                          title="Preview document"
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          className="text-text-muted hover:text-accent-blue transition-colors p-1"
                          onClick={() => handleEditDoc(doc)}
                          title="Edit metadata"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="text-text-muted hover:text-accent-expense transition-colors p-1"
                          onClick={() => handleDeleteDoc(doc.id)}
                          title="Delete document"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit Metadata Modal */}
      {editingDoc && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setEditingDoc(null)}>
          <div className="block-card-elevated w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-primary">Edit Document — {editingDoc.filename}</h3>
              <button className="text-text-muted hover:text-text-primary" onClick={() => setEditingDoc(null)}>
                <X size={16} />
              </button>
            </div>
            <div>
              <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1">Entity Type</label>
              <select
                className="block-select"
                value={editForm.entity_type}
                onChange={(e) => setEditForm({ ...editForm, entity_type: e.target.value })}
              >
                <option value="">None</option>
                <option value="client">Client</option>
                <option value="invoice">Invoice</option>
                <option value="expense">Expense</option>
                <option value="project">Project</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1">Tags (comma-separated)</label>
              <input
                type="text"
                className="block-input"
                value={editForm.tags}
                onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })}
                placeholder="receipt, tax, Q1"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button className="block-btn" onClick={() => setEditingDoc(null)}>Cancel</button>
              <button className="block-btn-primary" disabled={editSaving} onClick={handleSaveEdit}>
                {editSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
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
