import React, { useEffect, useState, useCallback } from 'react';
import { Mail, Save, Eye, History, RotateCcw, AlertTriangle } from 'lucide-react';
import { useCompanyStore } from '../../stores/companyStore';
import { useAuthStore } from '../../stores/authStore';
import { renderMarkdown } from '../../lib/markdown';

interface EmailTemplate {
  id: string;
  company_id: string;
  key: string;
  label: string;
  subject: string;
  body: string;
  body_format: string;
  available_tokens_json: string;
  default_to: string;
  default_cc: string;
  default_bcc: string;
}

interface TemplateHistory {
  id: string;
  template_id: string;
  version: number;
  snapshot_json: string;
  changed_at: string;
  changed_by: string;
}

function ipc(channel: string, payload?: any): Promise<any> {
  return (window as any).electronAPI.invoke(channel, payload);
}

const SAMPLE_CTX: Record<string, string> = {
  client_name: 'Acme Inc.',
  invoice_number: 'INV-2026-00042',
  total_due: '$1,250.00',
  due_date: '2026-05-23',
  company_name: 'My Company',
  days_overdue: '14',
  payment_link: 'https://accounting.rmpgutah.us/pay/sample',
};

// Note: renderMarkdown() escapes all HTML before applying its limited markdown
// transforms (bold/italic/code/link), so the resulting HTML is safe to inject.
const PreviewBody: React.FC<{ body: string }> = ({ body }) => (
  // eslint-disable-next-line react/no-danger
  <div dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />
);

const EmailTemplatesSettings: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const authUser = useAuthStore((s) => s.user);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [draft, setDraft] = useState<EmailTemplate | null>(null);
  const [savingId, setSavingId] = useState<string>('');
  const [validation, setValidation] = useState<{ ok: boolean; unknown: string[] } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<TemplateHistory[]>([]);

  const load = useCallback(async () => {
    if (!activeCompany) return;
    const rows = await ipc('email-tmpl:list', { companyId: activeCompany.id });
    if (Array.isArray(rows)) {
      setTemplates(rows);
      if (!selectedKey && rows.length > 0) {
        setSelectedKey(rows[0].key);
        setDraft(rows[0]);
      }
    }
  }, [activeCompany, selectedKey]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const t = templates.find(x => x.key === selectedKey);
    if (t) setDraft({ ...t });
  }, [selectedKey, templates]);

  const validate = async (d: EmailTemplate) => {
    const v = await ipc('email-tmpl:validate', {
      body: d.body, subject: d.subject, availableTokens: d.available_tokens_json,
    });
    setValidation(v);
  };

  useEffect(() => { if (draft) validate(draft); /* eslint-disable-next-line */ }, [draft?.body, draft?.subject]);

  const save = async () => {
    if (!draft) return;
    setSavingId(draft.id);
    try {
      await ipc('email-tmpl:save', {
        id: draft.id,
        data: {
          label: draft.label,
          subject: draft.subject,
          body: draft.body,
          body_format: draft.body_format || 'markdown',
          available_tokens_json: draft.available_tokens_json,
          default_to: draft.default_to || '',
          default_cc: draft.default_cc || '',
          default_bcc: draft.default_bcc || '',
        },
        changedBy: authUser?.email || '',
      });
      await load();
    } finally { setSavingId(''); }
  };

  const loadHistory = async () => {
    if (!draft) return;
    const h = await ipc('email-tmpl:history', { templateId: draft.id });
    if (Array.isArray(h)) setHistory(h);
    setShowHistory(true);
  };

  const rollback = async (version: number) => {
    if (!draft) return;
    if (!window.confirm(`Roll back to version ${version}? Current state will be saved as a new version.`)) return;
    await ipc('email-tmpl:rollback', { templateId: draft.id, version, changedBy: authUser?.email || '' });
    setShowHistory(false);
    await load();
  };

  if (!activeCompany || !draft) return null;
  const tokens: string[] = (() => { try { return JSON.parse(draft.available_tokens_json || '[]'); } catch { return []; } })();
  const previewSubject = draft.subject.replace(/\{\{\s*([\w_]+)\s*\}\}/g, (_m, k) => SAMPLE_CTX[k] || `{{${k}}}`);
  const previewBody = draft.body.replace(/\{\{\s*([\w_]+)\s*\}\}/g, (_m, k) => SAMPLE_CTX[k] || `{{${k}}}`);

  return (
    <div className="block-card space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 flex items-center justify-center bg-bg-tertiary border border-border-primary shrink-0" style={{ borderRadius: '6px' }}>
          <Mail size={16} className="text-accent-blue" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Email Templates</h3>
          <p className="text-xs text-text-muted mt-0.5">Customize subject + body for system emails. Use {`{{token}}`} for merge fields.</p>
        </div>
      </div>
      <div className="border-t border-border-primary pt-4 grid grid-cols-12 gap-3">
        <div className="col-span-3 space-y-1">
          {templates.map(t => (
            <button
              key={t.key}
              className="w-full text-left text-xs px-2 py-1.5 border"
              style={{
                borderRadius: '4px',
                background: t.key === selectedKey ? 'rgba(59,130,246,0.1)' : 'transparent',
                borderColor: t.key === selectedKey ? '#3b82f6' : 'var(--border-primary)',
                color: t.key === selectedKey ? '#3b82f6' : 'inherit',
              }}
              onClick={() => setSelectedKey(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="col-span-9 space-y-3 text-xs">
          <div>
            <label className="block text-text-muted mb-1">Label</label>
            <input className="block-input text-xs w-full" value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} />
          </div>
          <div>
            <label className="block text-text-muted mb-1">Subject</label>
            <input className="block-input text-xs w-full" value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value })} />
          </div>
          <div>
            <label className="block text-text-muted mb-1">Body (markdown)</label>
            <textarea className="block-input text-xs w-full font-mono" rows={8} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-text-muted mb-1">Default To</label>
              <input className="block-input text-xs w-full" placeholder="client.email or static@addr" value={draft.default_to || ''} onChange={e => setDraft({ ...draft, default_to: e.target.value })} />
            </div>
            <div>
              <label className="block text-text-muted mb-1">Default CC</label>
              <input className="block-input text-xs w-full" value={draft.default_cc || ''} onChange={e => setDraft({ ...draft, default_cc: e.target.value })} />
            </div>
            <div>
              <label className="block text-text-muted mb-1">Default BCC</label>
              <input className="block-input text-xs w-full" value={draft.default_bcc || ''} onChange={e => setDraft({ ...draft, default_bcc: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="block text-text-muted mb-1">Available tokens</label>
            <div className="flex flex-wrap gap-1">
              {tokens.map(tk => (
                <code key={tk} className="px-1.5 py-0.5 text-[11px]" style={{ background: 'var(--bg-tertiary)', borderRadius: 3 }}>
                  {`{{${tk}}}`}
                </code>
              ))}
            </div>
          </div>
          {validation && !validation.ok && (
            <div className="flex items-start gap-1.5 text-[11px]" style={{ color: '#f59e0b' }}>
              <AlertTriangle size={12} className="mt-0.5" />
              <span>Unknown tokens in body/subject: {validation.unknown.join(', ')}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button className="block-btn-primary text-xs flex items-center gap-1" disabled={savingId === draft.id} onClick={save}>
              <Save size={12} /> {savingId === draft.id ? 'Saving…' : 'Save'}
            </button>
            <button className="block-btn text-xs flex items-center gap-1" onClick={loadHistory}>
              <History size={12} /> History
            </button>
          </div>

          <div className="border-t border-border-primary pt-3">
            <div className="text-text-muted mb-1 flex items-center gap-1"><Eye size={12} /> Preview (against sample)</div>
            <div className="p-3 border border-border-primary" style={{ borderRadius: '6px', background: 'var(--bg-tertiary)' }}>
              <div className="font-semibold mb-1">{previewSubject}</div>
              <PreviewBody body={previewBody} />
            </div>
          </div>

          {showHistory && (
            <div className="border-t border-border-primary pt-3">
              <h4 className="text-text-primary font-semibold mb-2">Version History</h4>
              <div className="space-y-1">
                {history.length === 0 && <p className="text-text-muted">No prior versions.</p>}
                {history.map(h => (
                  <div key={h.id} className="flex items-center justify-between p-2 border border-border-primary" style={{ borderRadius: '4px' }}>
                    <span>v{h.version} — {new Date(h.changed_at).toLocaleString()} {h.changed_by ? `(${h.changed_by})` : ''}</span>
                    <button className="block-btn text-xs flex items-center gap-1" onClick={() => rollback(h.version)}>
                      <RotateCcw size={11} /> Rollback
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EmailTemplatesSettings;
