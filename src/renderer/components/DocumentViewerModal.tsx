import React from 'react';
import { X, ExternalLink } from 'lucide-react';
import type { Document } from '../../shared/types';
import api from '../lib/api';

interface DocumentViewerModalProps {
  doc: Document;
  onClose: () => void;
}

const formatFileSize = (bytes: number): string => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

const DocumentViewerModal: React.FC<DocumentViewerModalProps> = ({ doc, onClose }) => {
  const isPdf = doc.mime_type === 'application/pdf';
  const isImage = doc.mime_type?.startsWith('image/');
  const fileUrl = `file://${doc.file_path}`;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="block-card-elevated w-full max-w-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-primary truncate">{doc.filename}</h3>
          <button className="text-text-muted hover:text-text-primary transition-colors" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {isPdf && (
          <embed src={fileUrl} type="application/pdf" className="w-full h-[70vh]" />
        )}

        {isImage && (
          <img src={fileUrl} alt={doc.filename} className="max-w-full max-h-[70vh] mx-auto" />
        )}

        {!isPdf && !isImage && (
          <div className="space-y-3">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-text-muted">Type</span>
                <span className="text-text-secondary">{doc.mime_type || 'Unknown'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Size</span>
                <span className="text-text-secondary font-mono">{formatFileSize(doc.file_size)}</span>
              </div>
            </div>
            <button
              type="button"
              className="block-btn-primary flex items-center gap-2"
              onClick={() => api.openPath(doc.file_path)}
            >
              <ExternalLink size={14} />
              Open in Default App
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default DocumentViewerModal;
