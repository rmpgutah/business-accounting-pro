import React, { useEffect, useState } from 'react';
import { Paperclip, Upload, Trash2, Eye, File, Image, FileSpreadsheet, FileText } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import api from '../lib/api';
import { useCompanyStore } from '../stores/companyStore';
import type { Document } from '../../shared/types';
import DocumentViewerModal from './DocumentViewerModal';

interface AttachmentsPanelProps {
  entityType: string;
  entityId: string;
  label?: string;
}

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
  if (mime === 'application/pdf') return FileText;
  return File;
};

const AttachmentsPanel: React.FC<AttachmentsPanelProps> = ({ entityType, entityId, label = 'Attachments' }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [viewingDoc, setViewingDoc] = useState<Document | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    (async () => {
      if (!entityId || !activeCompany) {
        if (!ignore) setLoading(false);
        return;
      }
      try {
        const rows = await api.rawQuery(
          'SELECT * FROM documents WHERE company_id = ? AND entity_type = ? AND entity_id = ? ORDER BY uploaded_at DESC',
          [activeCompany.id, entityType, entityId]
        );
        if (!ignore) setDocs(Array.isArray(rows) ? rows : []);
      } catch (err: any) {
        console.error('Failed to load attachments:', err);
        if (!ignore) setError(err?.message || 'Failed to load attachments');
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId, activeCompany]);

  const handleUpload = async () => {
    if (!activeCompany || !entityId) return;
    setUploading(true);
    setError('');
    try {
      const doc = await api.uploadDocument(activeCompany.id, entityType, entityId);
      if (doc) setDocs((prev) => [doc, ...prev]);
    } catch (err: any) {
      console.error('Failed to upload attachment:', err);
      setError(err?.message || 'Failed to upload file');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this attachment?')) return;
    try {
      await api.remove('documents', id);
      setDocs((prev) => prev.filter((d) => d.id !== id));
    } catch (err: any) {
      console.error('Failed to delete attachment:', err);
      setError(err?.message || 'Failed to delete attachment');
    }
  };

  if (!entityId) return null;

  return (
    <div className="block-card p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Paperclip size={14} className="text-text-muted" />
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">{label}</span>
        </div>
        <button
          type="button"
          className="block-btn flex items-center gap-1.5 text-xs"
          onClick={handleUpload}
          disabled={uploading}
        >
          <Upload size={12} />
          {uploading ? 'Uploading...' : 'Attach File'}
        </button>
      </div>

      {error && <div className="text-xs text-accent-expense">{error}</div>}

      {loading ? (
        <div className="text-xs text-text-muted">Loading...</div>
      ) : docs.length === 0 ? (
        <div className="text-xs text-text-muted">No files attached.</div>
      ) : (
        <div className="space-y-1">
          {docs.map((doc) => {
            const FileIcon = getFileIcon(doc.mime_type);
            return (
              <div
                key={doc.id}
                className="flex items-center justify-between gap-2 py-1"
                style={{ borderTop: '1px solid var(--hairline)' }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileIcon size={14} className="text-text-muted shrink-0" />
                  <span className="text-xs text-text-primary truncate">{doc.filename}</span>
                  <span className="text-[10px] text-text-muted shrink-0">{formatFileSize(doc.file_size)}</span>
                  <span className="text-[10px] text-text-muted shrink-0">
                    {doc.uploaded_at ? format(parseISO(doc.uploaded_at), 'MMM d, yyyy') : ''}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    className="text-text-muted hover:text-accent-blue transition-colors p-1"
                    onClick={() => setViewingDoc(doc)}
                    title="View"
                  >
                    <Eye size={13} />
                  </button>
                  <button
                    type="button"
                    className="text-text-muted hover:text-accent-expense transition-colors p-1"
                    onClick={() => handleDelete(doc.id)}
                    title="Delete"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {viewingDoc && <DocumentViewerModal doc={viewingDoc} onClose={() => setViewingDoc(null)} />}
    </div>
  );
};

export default AttachmentsPanel;
