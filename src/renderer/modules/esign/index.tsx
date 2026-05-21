import React, { useEffect, useState, useCallback } from 'react';
import {
  PenTool, Plus, FileText, Shield, ShieldCheck, ShieldOff, Trash2,
  Download, Eye, X, Check, AlertTriangle, Clock, User, Key, History,
  Search, ArrowLeft, ExternalLink, Pencil, Lock, Unlock, RefreshCw,
} from 'lucide-react';
import api from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/format';

type Tab = 'documents' | 'create';
type View = 'list' | 'detail';

interface EsignDoc {
  id: string;
  title: string;
  description: string;
  content: string;
  content_hash: string;
  status: 'draft' | 'pending' | 'signed' | 'revoked';
  created_by: string;
  created_at: string;
  updated_at: string;
  signatures?: any[];
  permissions?: any[];
  auditLog?: any[];
  verified?: boolean;
  signedCount?: number;
}

const STATUS_BADGE: Record<string, { class: string; label: string }> = {
  draft: { class: 'block-badge', label: 'Draft' },
  pending: { class: 'block-badge block-badge-warning', label: 'Pending' },
  signed: { class: 'block-badge block-badge-income', label: 'Signed' },
  revoked: { class: 'block-badge block-badge-expense', label: 'Revoked' },
};

const EsignModule: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('documents');
  const [docs, setDocs] = useState<EsignDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [selectedDoc, setSelectedDoc] = useState<EsignDoc | null>(null);
  const [view, setView] = useState<View>('list');

  // Create form
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formContent, setFormContent] = useState('');
  const [saving, setSaving] = useState(false);

  // Sign dialog
  const [showSignDialog, setShowSignDialog] = useState(false);
  const [typedName, setTypedName] = useState('');
  const [signing, setSigning] = useState(false);

  // Permission dialog
  const [showPermDialog, setShowPermDialog] = useState(false);
  const [permissions, setPermissions] = useState<Array<{ userId: string; level: string }>>([]);
  const [permUserId, setPermUserId] = useState('');
  const [permLevel, setPermLevel] = useState('view');

  // Verify result
  const [verifyResult, setVerifyResult] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const filters: any = {};
      if (statusFilter) filters.status = statusFilter;
      const rows = await api.esignList(filters);
      setDocs(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.error('Failed to load esign docs:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (id: string) => {
    try {
      const doc = await api.esignGet(id);
      if (doc) {
        setSelectedDoc(doc);
        setView('detail');
      }
    } catch (err) {
      console.error('Failed to load document:', err);
    }
  };

  const handleCreate = async () => {
    if (!formTitle.trim() || !formContent.trim()) return;
    setSaving(true);
    try {
      await api.esignCreate(formTitle.trim(), formDesc.trim(), formContent);
      setFormTitle('');
      setFormDesc('');
      setFormContent('');
      setActiveTab('documents');
      await load();
    } catch (err: any) {
      alert('Failed to create document: ' + (err?.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this document permanently?')) return;
    try {
      await api.esignDelete(id);
      if (selectedDoc?.id === id) setView('list');
      await load();
    } catch (err: any) {
      alert('Failed to delete: ' + (err?.message || 'Unknown error'));
    }
  };

  const handleSign = async () => {
    if (!typedName.trim()) return;
    setSigning(true);
    try {
      const result = await api.esignSign(selectedDoc!.id, typedName.trim(), 'user', '', typedName.trim());
      if (result.error) { alert(result.error); return; }
      setShowSignDialog(false);
      setTypedName('');
      await openDetail(selectedDoc!.id);
    } catch (err: any) {
      alert('Failed to sign: ' + (err?.message || 'Unknown error'));
    } finally {
      setSigning(false);
    }
  };

  const handleRevoke = async () => {
    const reason = prompt('Reason for revocation:');
    try {
      await api.esignRevoke(selectedDoc!.id, reason || undefined);
      await openDetail(selectedDoc!.id);
    } catch (err: any) {
      alert('Failed to revoke: ' + (err?.message || 'Unknown error'));
    }
  };

  const handleVerify = async () => {
    try {
      const result = await api.esignVerify(selectedDoc!.id);
      setVerifyResult(result);
    } catch (err: any) {
      alert('Failed to verify: ' + (err?.message || 'Unknown error'));
    }
  };

  const handleSavePermissions = async () => {
    try {
      await api.esignSetPermissions(selectedDoc!.id, permissions);
      setShowPermDialog(false);
      await openDetail(selectedDoc!.id);
    } catch (err: any) {
      alert('Failed to save permissions: ' + (err?.message || 'Unknown error'));
    }
  };

  const loadPermissions = async () => {
    try {
      const perms = await api.esignGetPermissions(selectedDoc!.id);
      setPermissions(Array.isArray(perms) ? perms.map((p: any) => ({ userId: p.user_id, level: p.permission_level })) : []);
    } catch (_) {}
  };

  const filteredDocs = docs.filter(d =>
    d.title.toLowerCase().includes(search.toLowerCase())
  );

  // ─── Render: Document List ────────────────────────────
  if (view === 'list') {
    return (
      <div className="p-6 space-y-6 overflow-y-auto h-full">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PenTool size={20} className="text-text-muted" />
            <h1 className="text-lg font-bold text-text-primary">E-Sign Documents</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              className={`block-btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold ${activeTab === 'create' ? 'bg-accent-blue/10 text-accent-blue' : ''}`}
              onClick={() => setActiveTab(activeTab === 'create' ? 'documents' : 'create')}
            >
              <Plus size={14} /> {activeTab === 'create' ? 'View Documents' : 'New Document'}
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--color-border-primary)' }}>
          {(['documents', 'create'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '8px 20px', fontSize: '12px', fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '0.6px',
                background: 'transparent', border: 'none', cursor: 'pointer',
                borderBottom: activeTab === tab ? '2px solid var(--color-accent)' : '2px solid transparent',
                color: activeTab === tab ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              }}
            >
              {tab === 'documents' ? 'All Documents' : 'Create Document'}
            </button>
          ))}
        </div>

        {activeTab === 'create' ? (
          /* Create Document Form */
          <div className="block-card p-6 space-y-4" style={{ borderRadius: '6px' }}>
            <h2 className="text-sm font-bold text-text-primary">New E-Sign Document</h2>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Title *</label>
              <input className="block-input w-full" placeholder="e.g. Employment Agreement 2026" value={formTitle} onChange={(e) => setFormTitle(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Description</label>
              <input className="block-input w-full" placeholder="Brief description of this document" value={formDesc} onChange={(e) => setFormDesc(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Document Content *</label>
              <p className="text-[10px] text-text-muted mb-2">Enter the document text. This content will be hashed for tamper verification.</p>
              <textarea
                className="block-input w-full font-mono text-sm"
                style={{ minHeight: '300px', resize: 'vertical' }}
                placeholder="Enter the full document content here..."
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button className="block-btn text-text-secondary px-4 py-2 text-sm" onClick={() => setActiveTab('documents')}>Cancel</button>
              <button className="block-btn-primary px-4 py-2 text-sm font-semibold" onClick={handleCreate} disabled={saving || !formTitle.trim() || !formContent.trim()}>
                {saving ? 'Creating...' : 'Create Document'}
              </button>
            </div>
          </div>
        ) : (
          /* Document List */
          <>
            {/* Filters */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-xs">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  className="block-input w-full pl-9"
                  placeholder="Search documents..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select className="block-select text-xs" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All Statuses</option>
                <option value="draft">Draft</option>
                <option value="pending">Pending</option>
                <option value="signed">Signed</option>
                <option value="revoked">Revoked</option>
              </select>
            </div>

            {loading ? (
              <div className="flex items-center justify-center h-32"><span className="text-text-muted text-sm font-mono">Loading...</span></div>
            ) : filteredDocs.length === 0 ? (
              <div className="block-card p-8 text-center" style={{ borderRadius: '6px' }}>
                <PenTool size={32} className="mx-auto text-text-muted mb-2" />
                <p className="text-text-muted text-sm">No e-sign documents yet.</p>
                <button className="block-btn-primary inline-flex items-center gap-1.5 mt-3 text-xs px-3 py-1.5" onClick={() => setActiveTab('create')}>
                  <Plus size={12} /> Create Your First Document
                </button>
              </div>
            ) : (
              <div className="block-card" style={{ borderRadius: '6px', overflow: 'hidden' }}>
                <table className="block-table">
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Status</th>
                      <th>Created</th>
                      <th>Updated</th>
                      <th>Created By</th>
                      <th style={{width: 100}}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDocs.map((doc) => {
                      const badge = STATUS_BADGE[doc.status] || STATUS_BADGE.draft;
                      return (
                        <tr key={doc.id} className="cursor-pointer hover:bg-bg-secondary/50" onClick={() => openDetail(doc.id)}>
                          <td className="font-medium text-text-primary">{doc.title}</td>
                          <td><span className={badge.class} style={{ fontSize: '10px' }}>{badge.label}</span></td>
                          <td className="text-xs text-text-muted font-mono">{formatDateTime(doc.created_at)}</td>
                          <td className="text-xs text-text-muted font-mono">{formatDateTime(doc.updated_at)}</td>
                          <td className="text-xs text-text-muted">{doc.created_by}</td>
                          <td>
                            <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                              <button className="text-text-muted hover:text-accent-blue transition-colors p-0.5" onClick={() => openDetail(doc.id)} title="View"><Eye size={12} /></button>
                              <button className="text-text-muted hover:text-accent-expense transition-colors p-0.5" onClick={() => handleDelete(doc.id)} title="Delete"><Trash2 size={12} /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // ─── Render: Document Detail ────────────────────────────
  if (!selectedDoc) return null;
  const badge = STATUS_BADGE[selectedDoc.status] || STATUS_BADGE.draft;

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button className="block-btn inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary transition-colors" onClick={() => { setView('list'); setSelectedDoc(null); setVerifyResult(null); }}>
          <ArrowLeft size={16} /> Back
        </button>
        <PenTool size={18} className="text-text-muted" />
        <h1 className="text-lg font-bold text-text-primary flex-1">{selectedDoc.title}</h1>
        <span className={badge.class} style={{ fontSize: '11px' }}>{badge.label}</span>
      </div>

      {/* Verify Alert */}
      {verifyResult && (
        <div className={`block-card p-3 flex items-center gap-2 text-sm ${verifyResult.verified ? 'text-accent-income' : 'text-accent-expense'}`} style={{ borderRadius: '6px' }}>
          {verifyResult.verified ? <ShieldCheck size={16} /> : <ShieldOff size={16} />}
          {verifyResult.verified
            ? 'Document verified — content hash matches and signatures are valid.'
            : !verifyResult.hashMatch
              ? 'TAMPER DETECTED — Document content has been modified since the last signature. Current hash does not match.'
              : 'Document has not been signed yet.'}
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="col-span-2 space-y-4">
          {/* Document Info */}
          <div className="block-card p-4 space-y-2" style={{ borderRadius: '6px' }}>
            {selectedDoc.description && (
              <p className="text-sm text-text-muted">{selectedDoc.description}</p>
            )}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><span className="text-text-muted">Created:</span> <span className="font-mono">{formatDateTime(selectedDoc.created_at)}</span></div>
              <div><span className="text-text-muted">Updated:</span> <span className="font-mono">{formatDateTime(selectedDoc.updated_at)}</span></div>
              <div><span className="text-text-muted">Created By:</span> <span>{selectedDoc.created_by}</span></div>
              <div><span className="text-text-muted">Content Hash:</span> <span className="font-mono text-[10px]" title={selectedDoc.content_hash}>{selectedDoc.content_hash?.slice(0, 16)}...</span></div>
            </div>
          </div>

          {/* Document Content Preview */}
          <div className="block-card p-4" style={{ borderRadius: '6px' }}>
            <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2">Document Content</h3>
            <div className="bg-bg-secondary p-4 rounded text-sm whitespace-pre-wrap font-mono text-text-primary leading-relaxed" style={{ maxHeight: '400px', overflow: 'auto' }}>
              {selectedDoc.content || 'No content'}
            </div>
          </div>

          {/* Signatures */}
          <div className="block-card p-4" style={{ borderRadius: '6px' }}>
            <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3">Signatures ({selectedDoc.signatures?.length || 0})</h3>
            {(!selectedDoc.signatures || selectedDoc.signatures.length === 0) ? (
              <p className="text-sm text-text-muted">No signatures yet.</p>
            ) : (
              <div className="space-y-2">
                {selectedDoc.signatures.map((sig: any) => (
                  <div key={sig.id} className="flex items-center gap-3 bg-bg-secondary p-3 rounded" style={{ borderRadius: '6px' }}>
                    <div className="w-8 h-8 rounded-full bg-accent-income/20 flex items-center justify-center">
                      <ShieldCheck size={14} className="text-accent-income" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-text-primary">{sig.typed_name}</p>
                      <p className="text-xs text-text-muted">
                        {sig.signer_name} &middot; {formatDateTime(sig.signed_at)}
                      </p>
                    </div>
                    <span className="text-[10px] font-mono text-text-muted">{sig.signature_hash?.slice(0, 12)}...</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Audit Log */}
          <div className="block-card p-4" style={{ borderRadius: '6px' }}>
            <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <History size={12} /> Audit Trail
            </h3>
            {(!selectedDoc.auditLog || selectedDoc.auditLog.length === 0) ? (
              <p className="text-sm text-text-muted">No audit events recorded.</p>
            ) : (
              <div className="space-y-1.5">
                {selectedDoc.auditLog.map((log: any) => (
                  <div key={log.id} className="flex items-start gap-2 text-xs py-1.5 border-b border-border-primary last:border-0">
                    <div className="w-5 h-5 rounded-full bg-bg-secondary flex items-center justify-center flex-shrink-0 mt-0.5">
                      {log.action === 'created' && <FileText size={10} className="text-accent-blue" />}
                      {log.action === 'edited' && <Pencil size={10} className="text-accent-expense" />}
                      {log.action === 'signed' && <ShieldCheck size={10} className="text-accent-income" />}
                      {log.action === 'revoked' && <ShieldOff size={10} className="text-accent-expense" />}
                      {log.action === 'permission_changed' && <Key size={10} className="text-accent-blue" />}
                      {log.action === 'verified' && <Check size={10} className="text-accent-income" />}
                      {log.action === 'status_changed' && <RefreshCw size={10} className="text-text-muted" />}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold capitalize text-text-primary">{log.action.replace(/_/g, ' ')}</span>
                        <span className="text-text-muted">by {log.performed_by}</span>
                      </div>
                      {log.details && <p className="text-text-muted mt-0.5">{log.details}</p>}
                      <p className="text-text-muted/60 font-mono mt-0.5">{formatDateTime(log.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar - Actions */}
        <div className="space-y-4">
          {/* Actions Card */}
          <div className="block-card p-4 space-y-3" style={{ borderRadius: '6px' }}>
            <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider">Actions</h3>

            {selectedDoc.status !== 'signed' && selectedDoc.status !== 'revoked' && (
              <button
                className="block-btn-primary w-full flex items-center gap-2 text-xs justify-center py-2"
                onClick={() => { setTypedName(''); setShowSignDialog(true); }}
              >
                <PenTool size={12} /> Sign Document
              </button>
            )}

            <button
              className="block-btn w-full flex items-center gap-2 text-xs justify-center py-2"
              onClick={handleVerify}
            >
              <Shield size={12} /> Verify Integrity
            </button>

            {selectedDoc.status === 'signed' && (
              <button
                className="block-btn w-full flex items-center gap-2 text-xs justify-center py-2 text-accent-expense"
                onClick={handleRevoke}
              >
                <ShieldOff size={12} /> Revoke Document
              </button>
            )}

            <button
              className="block-btn w-full flex items-center gap-2 text-xs justify-center py-2"
              onClick={() => { loadPermissions(); setShowPermDialog(true); }}
            >
              <Lock size={12} /> Manage Permissions
            </button>

            {(selectedDoc.status === 'draft' || selectedDoc.status === 'pending') && (
              <button
                className="block-btn w-full flex items-center gap-2 text-xs justify-center py-2 text-accent-expense"
                onClick={() => handleDelete(selectedDoc.id)}
              >
                <Trash2 size={12} /> Delete Document
              </button>
            )}
          </div>

          {/* Verification Status Card */}
          <div className="block-card p-4" style={{ borderRadius: '6px' }}>
            <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2">Verification</h3>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Status</span>
                <span className={badge.class} style={{ fontSize: '10px' }}>{badge.label}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Signatures</span>
                <span className="font-semibold">{selectedDoc.signedCount || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Created</span>
                <span className="font-mono text-[10px]">{formatDate(selectedDoc.created_at)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Verified</span>
                <span>{selectedDoc.verified !== undefined ? (selectedDoc.verified ? <ShieldCheck size={12} className="text-accent-income inline" /> : <ShieldOff size={12} className="text-accent-expense inline" />) : '—'}</span>
              </div>
            </div>
          </div>

          {/* Permissions Summary */}
          <div className="block-card p-4" style={{ borderRadius: '6px' }}>
            <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2">Permissions</h3>
            {(!selectedDoc.permissions || selectedDoc.permissions.length === 0) ? (
              <p className="text-xs text-text-muted">No custom permissions set. Only admins can edit.</p>
            ) : (
              <div className="space-y-1.5">
                {selectedDoc.permissions.map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between text-xs">
                    <span className="truncate">{p.user_id || 'User'}</span>
                    <span className="capitalize text-text-muted">{p.permission_level}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sign Dialog */}
      {showSignDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowSignDialog(false)}>
          <div className="block-card p-6 w-full max-w-md mx-4" style={{ borderRadius: '6px' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-text-primary">Sign Document</h2>
              <button className="text-text-muted hover:text-text-primary" onClick={() => setShowSignDialog(false)}><X size={16} /></button>
            </div>
            <p className="text-xs text-text-muted mb-4">
              By typing your full name below, you are electronically signing this document. This constitutes a legally binding typed signature.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Type Your Full Name *</label>
                <input
                  className="block-input w-full font-semibold text-base"
                  placeholder="John A. Doe"
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter' && typedName.trim()) handleSign(); }}
                />
              </div>
              <div className="flex items-center gap-2 text-xs text-text-muted bg-bg-secondary p-2.5 rounded" style={{ borderRadius: '4px' }}>
                <ShieldCheck size={14} className="text-accent-income flex-shrink-0" />
                Your typed signature will be hashed and stored securely. The document content hash will be linked to this signature.
              </div>
              <div className="flex gap-2 justify-end">
                <button className="block-btn text-xs px-3 py-1.5" onClick={() => setShowSignDialog(false)}>Cancel</button>
                <button className="block-btn-primary text-xs px-4 py-1.5 flex items-center gap-1.5" onClick={handleSign} disabled={signing || !typedName.trim()}>
                  <PenTool size={12} /> {signing ? 'Signing...' : 'Sign Document'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Permissions Dialog */}
      {showPermDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowPermDialog(false)}>
          <div className="block-card p-6 w-full max-w-lg mx-4" style={{ borderRadius: '6px' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-text-primary">Manage Permissions</h2>
              <button className="text-text-muted hover:text-text-primary" onClick={() => setShowPermDialog(false)}><X size={16} /></button>
            </div>
            <p className="text-xs text-text-muted mb-4">
              Control who can view, edit, sign, or administrate this document.
            </p>

            {/* Add Permission */}
            <div className="flex items-center gap-2 mb-4">
              <input
                className="block-input flex-1 text-xs"
                placeholder="User ID or email"
                value={permUserId}
                onChange={(e) => setPermUserId(e.target.value)}
              />
              <select className="block-select text-xs" value={permLevel} onChange={(e) => setPermLevel(e.target.value)}>
                <option value="view">View</option>
                <option value="edit">Edit</option>
                <option value="sign">Sign</option>
                <option value="admin">Admin</option>
              </select>
              <button
                className="block-btn-primary flex items-center gap-1 text-xs px-2 py-1.5"
                onClick={() => {
                  if (!permUserId.trim()) return;
                  setPermissions(p => [...p.filter(x => x.userId !== permUserId.trim()), { userId: permUserId.trim(), level: permLevel }]);
                  setPermUserId('');
                }}
              >
                <Plus size={12} /> Add
              </button>
            </div>

            {/* Permission List */}
            {permissions.length === 0 ? (
              <p className="text-xs text-text-muted text-center py-4">No custom permissions. Only admins have access.</p>
            ) : (
              <div className="space-y-1.5 mb-4">
                {permissions.map((p, i) => (
                  <div key={i} className="flex items-center justify-between bg-bg-secondary p-2 rounded" style={{ borderRadius: '4px' }}>
                    <span className="text-xs font-mono">{p.userId}</span>
                    <div className="flex items-center gap-2">
                      <select className="block-select text-[10px] py-0.5" value={p.level} onChange={(e) => {
                        const updated = [...permissions];
                        updated[i].level = e.target.value;
                        setPermissions(updated);
                      }}>
                        <option value="view">View</option>
                        <option value="edit">Edit</option>
                        <option value="sign">Sign</option>
                        <option value="admin">Admin</option>
                      </select>
                      <button className="text-text-muted hover:text-accent-expense" onClick={() => setPermissions(p => p.filter((_, idx) => idx !== i))}>
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button className="block-btn text-xs px-3 py-1.5" onClick={() => setShowPermDialog(false)}>Cancel</button>
              <button className="block-btn-primary text-xs px-4 py-1.5" onClick={handleSavePermissions}>Save Permissions</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EsignModule;