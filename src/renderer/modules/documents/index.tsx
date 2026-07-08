import React, { useEffect, useState, useMemo } from 'react';
import {
  FileText, Upload, Search, Filter, Eye, File, Image, FileSpreadsheet, Pencil, Trash2, X,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import ErrorBanner from '../../components/ErrorBanner';
import DocumentViewerModal from '../../components/DocumentViewerModal';

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

type EntityFilter = '' | 'client' | 'invoice' | 'expense' | 'project'
  | 'vendor' | 'bill' | 'purchase_order' | 'employee' | 'fixed_asset' | 'tax_payment' | 'bank_account' | 'debt';

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
  vendor: 'block-badge block-badge-blue',
  bill: 'block-badge block-badge-expense',
  purchase_order: 'block-badge block-badge-purple',
  employee: 'block-badge block-badge-blue',
  fixed_asset: 'block-badge block-badge-purple',
  tax_payment: 'block-badge block-badge-warning',
  bank_account: 'block-badge block-badge-blue',
  debt: 'block-badge block-badge-expense',
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
  const [error, setError] = useState('');

  const handleDocSort = (f: DocSortField) => { if (sortField === f) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortField(f); setSortDir('asc'); } };

  const loadDocuments = async () => {
    if (!activeCompany) return;
    setError('');
    try {
      // Perf: cap at 1000 most-recent documents; older docs surfaced via search/filter UI.
      // Resolve the polymorphic entity FK to a readable name (the flat query
      // returned only entity_id, so the Entity column showed a raw uuid). Unknown
      // entity types fall through to NULL → entity_id, the prior behavior.
      const rows = await api.rawQuery(
        `SELECT d.*,
           CASE d.entity_type
             WHEN 'client'  THEN (SELECT name FROM clients WHERE id = d.entity_id)
             WHEN 'invoice' THEN (SELECT invoice_number FROM invoices WHERE id = d.entity_id)
             WHEN 'project' THEN (SELECT name FROM projects WHERE id = d.entity_id)
             WHEN 'expense' THEN (SELECT description FROM expenses WHERE id = d.entity_id)
             WHEN 'vendor'         THEN (SELECT name FROM vendors WHERE id = d.entity_id)
             WHEN 'bill'           THEN (SELECT bill_number FROM bills WHERE id = d.entity_id)
             WHEN 'purchase_order' THEN (SELECT po_number FROM purchase_orders WHERE id = d.entity_id)
             WHEN 'employee'       THEN (SELECT name FROM employees WHERE id = d.entity_id)
             WHEN 'fixed_asset'    THEN (SELECT name FROM fixed_assets WHERE id = d.entity_id)
             WHEN 'tax_payment'    THEN (SELECT confirmation_number FROM tax_payments WHERE id = d.entity_id)
             WHEN 'bank_account'   THEN (SELECT name FROM bank_accounts WHERE id = d.entity_id)
             WHEN 'debt'           THEN (SELECT debtor_name FROM debts WHERE id = d.entity_id)
           END AS entity_name
         FROM documents d
         WHERE d.company_id = ?
         ORDER BY d.uploaded_at DESC
         LIMIT 1000`,
        [activeCompany.id]
      );
      setDocuments(Array.isArray(rows) ? rows : []);
    } catch (err: any) {
      console.error('Failed to load documents:', err);
      setError(err?.message || 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, [activeCompany]);

  const handleUpload = async () => {
    if (!activeCompany) return;
    try {
      const doc = await api.uploadDocument(activeCompany.id, '', '');
      if (!doc) return; // user cancelled
      setDocuments((prev) => [doc as unknown as Document, ...prev]);
      setOpSuccess('Document uploaded'); setTimeout(() => setOpSuccess(''), 3000);
    } catch (err: any) {
      // VISIBILITY: surface upload errors via banner instead of duplicate alert
      console.error('Failed to upload document:', err);
      setOpError('Failed to upload: ' + (err?.message || String(err))); setTimeout(() => setOpError(''), 5000);
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
      // VISIBILITY: surface update errors via banner instead of duplicate alert
      console.error('Failed to update document:', err);
      setOpError('Failed to update: ' + (err?.message || String(err))); setTimeout(() => setOpError(''), 5000);
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
      // VISIBILITY: surface delete errors via banner instead of duplicate alert
      console.error('Failed to delete document:', err);
      setOpError('Failed to delete: ' + (err?.message || String(err))); setTimeout(() => setOpError(''), 5000);
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
      {error && <ErrorBanner message={error} title="Failed to load documents" onDismiss={() => setError('')} />}
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
              <option value="vendor">Vendor</option>
              <option value="bill">Bill</option>
              <option value="purchase_order">Purchase Order</option>
              <option value="employee">Employee</option>
              <option value="fixed_asset">Fixed Asset</option>
              <option value="tax_payment">Tax Payment</option>
              <option value="bank_account">Bank Account</option>
              <option value="debt">Debt</option>
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
          <p className="text-sm text-text-secondary font-medium">
            {documents.length === 0 ? 'No documents yet' : 'No documents match your filter'}
          </p>
          <p className="text-xs text-text-muted mt-1">
            {documents.length === 0
              ? 'Upload your first document to get started.'
              : 'Try clearing the search or filters above.'}
          </p>
          {documents.length === 0 && (
            <button className="block-btn-primary mt-3 flex items-center gap-2" onClick={handleUpload}>
              <Upload size={14} /> Upload Document
            </button>
          )}
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
                        <span className="text-text-primary font-medium block truncate max-w-[200px]">{doc.filename}</span>
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
                    <td className="text-text-secondary truncate max-w-[160px]">
                      {doc.entity_name || doc.entity_id || '-'}
                    </td>
                    <td>
                      {doc.tags ? (
                        <div className="flex flex-wrap gap-1">
                          {doc.tags.split(',').map((tag) => {
                            const t = tag.trim();
                            return (
                              <span key={`${doc.id}:${t}`} className="block-badge block-badge-purple text-[10px]">
                                {t}
                              </span>
                            );
                          })}
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
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 cursor-pointer" onClick={() => setEditingDoc(null)}>
          <div className="block-card-elevated w-full max-w-md space-y-4 cursor-pointer" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-primary">Edit Document — {editingDoc.filename}</h3>
              <button className="text-text-muted hover:text-text-primary transition-colors" onClick={() => setEditingDoc(null)}>
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
                <option value="vendor">Vendor</option>
                <option value="bill">Bill</option>
                <option value="purchase_order">Purchase Order</option>
                <option value="employee">Employee</option>
                <option value="fixed_asset">Fixed Asset</option>
                <option value="tax_payment">Tax Payment</option>
                <option value="bank_account">Bank Account</option>
                <option value="debt">Debt</option>
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
        <DocumentViewerModal doc={previewDoc as unknown as import('../../../shared/types').Document} onClose={() => setPreviewDoc(null)} />
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
