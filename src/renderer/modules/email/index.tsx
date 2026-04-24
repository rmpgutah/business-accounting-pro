import React, { useState, useEffect } from 'react';
import { Mail, Send, Clock, AlertCircle, Plus, Settings, Search } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

interface EmailLogEntry {
  id: string;
  recipient: string;
  subject: string;
  body_preview: string;
  entity_type: string;
  entity_id: string;
  status: string;
  error: string | null;
  sent_at: string;
}

interface EmailTemplate {
  key: string;
  name: string;
  subject: string;
  body: string;
}

const DEFAULT_TEMPLATES: EmailTemplate[] = [
  {
    key: 'invoice_sent',
    name: 'Invoice Sent',
    subject: 'Invoice {{invoice_number}} from {{company_name}}',
    body: 'Dear {{client_name}},\n\nPlease find attached invoice {{invoice_number}} for {{amount}}.\n\nDue date: {{due_date}}\n\nThank you for your business.\n\n{{company_name}}',
  },
  {
    key: 'payment_received',
    name: 'Payment Received',
    subject: 'Payment Confirmation - {{company_name}}',
    body: 'Dear {{client_name}},\n\nWe have received your payment of {{amount}} for invoice {{invoice_number}}.\n\nThank you!\n\n{{company_name}}',
  },
  {
    key: 'overdue_reminder',
    name: 'Overdue Reminder',
    subject: 'Overdue: Invoice {{invoice_number}} - {{company_name}}',
    body: 'Dear {{client_name}},\n\nThis is a friendly reminder that invoice {{invoice_number}} for {{amount}} was due on {{due_date}}.\n\nPlease arrange payment at your earliest convenience.\n\nThank you,\n{{company_name}}',
  },
];

export default function EmailModule() {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [tab, setTab] = useState<'log' | 'templates' | 'settings'>('log');
  const [emailLog, setEmailLog] = useState<EmailLogEntry[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>(DEFAULT_TEMPLATES);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [smtpConfig, setSmtpConfig] = useState({
    host: '',
    port: '587',
    username: '',
    password: '',
    from_name: '',
    from_email: '',
    secure: true,
  });

  useEffect(() => {
    loadEmailLog();
    loadSmtpConfig();
    loadTemplates();
  }, [activeCompany]);

  const loadTemplates = async () => {
    try {
      // Bug fix: use scoped getSetting instead of unscoped rawQuery on settings.
      const value = await api.getSetting('email_templates');
      if (value) {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setTemplates(parsed);
        }
      }
    } catch { /* use defaults */ }
  };

  const saveTemplates = async (updated: EmailTemplate[]) => {
    try {
      await api.setSetting('email_templates', JSON.stringify(updated));
    } catch (err: any) {
      console.error('Failed to save email templates:', err);
      alert('Failed to save email templates: ' + (err?.message || 'Unknown error'));
    }
  };

  const loadEmailLog = async () => {
    if (!activeCompany) return;
    try {
      const logs = await api.query('email_log', { company_id: activeCompany.id }, { field: 'sent_at', dir: 'desc' }, 100);
      setEmailLog(logs);
    } catch { /* empty */ }
  };

  const loadSmtpConfig = async () => {
    try {
      // Bug fix: use scoped listSettings instead of unscoped api.query('settings').
      const settings = await api.listSettings();
      const config: Record<string, string> = {};
      for (const s of settings) {
        if (s.key.startsWith('smtp_')) config[s.key.replace('smtp_', '')] = s.value;
      }
      if (Object.keys(config).length > 0) {
        setSmtpConfig((prev) => ({ ...prev, ...config }));
      }
    } catch { /* empty */ }
  };

  const saveSmtpConfig = async () => {
    for (const [key, value] of Object.entries(smtpConfig)) {
      try {
        await api.setSetting(`smtp_${key}`, String(value));
      } catch { /* empty */ }
    }
  };

  const filteredLog = emailLog.filter(
    (e) =>
      e.recipient.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.subject.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const tabs = [
    { id: 'log' as const, label: 'Email Log', icon: Mail },
    { id: 'templates' as const, label: 'Templates', icon: FileText },
    { id: 'settings' as const, label: 'SMTP Settings', icon: Settings },
  ];

  return (
    <div>
      <div className="module-header">
        <h1 className="module-title">Email Integration</h1>
      </div>

      <div className="flex gap-2 mb-6">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'bg-accent-blue text-white'
                  : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-primary'
              }`}
              style={{ borderRadius: '6px' }}
            >
              <Icon size={14} />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'log' && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                className="block-input pl-9"
                placeholder="Search emails..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {filteredLog.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                <Mail size={24} className="text-text-muted" />
              </div>
              <p className="text-text-secondary text-sm">No emails sent yet</p>
              <p className="text-text-muted text-xs mt-1">Emails will appear here when you send invoices or reminders</p>
            </div>
          ) : (
            <table className="block-table">
              <thead>
                <tr>
                  <th>To</th>
                  <th>Subject</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Sent</th>
                </tr>
              </thead>
              <tbody>
                {filteredLog.map((entry) => (
                  <tr key={entry.id}>
                    <td className="text-text-primary">{entry.recipient}</td>
                    <td className="text-text-secondary">{entry.subject}</td>
                    <td>
                      <span className="block-badge-blue">{entry.entity_type}</span>
                    </td>
                    <td>
                      <span className={`${entry.status === 'sent' ? 'block-badge-income' : 'block-badge-expense'} capitalize`}>
                        {entry.status}
                      </span>
                    </td>
                    <td className="text-text-muted text-xs">{entry.sent_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'templates' && (
        <div className="space-y-4">
          {editingTemplate ? (
            <div className="block-card space-y-4">
              <h3 className="text-sm font-semibold text-text-primary">{editingTemplate.name}</h3>
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Subject</label>
                <input
                  className="block-input"
                  value={editingTemplate.subject}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, subject: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Body</label>
                <textarea
                  className="block-input"
                  rows={8}
                  value={editingTemplate.body}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, body: e.target.value })}
                />
              </div>
              <p className="text-xs text-text-muted">
                Variables: {'{{client_name}}'}, {'{{invoice_number}}'}, {'{{amount}}'}, {'{{due_date}}'}, {'{{company_name}}'}
              </p>
              <div className="flex gap-2">
                <button className="block-btn-primary" onClick={() => {
                  const updated = templates.map((t) => (t.key === editingTemplate.key ? editingTemplate : t));
                  setTemplates(updated);
                  saveTemplates(updated);
                  setEditingTemplate(null);
                }}>
                  Save Template
                </button>
                <button className="block-btn" onClick={() => setEditingTemplate(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            templates.map((t) => (
              <div key={t.key} className="block-card flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-text-primary">{t.name}</h3>
                  <p className="text-xs text-text-muted mt-1">Subject: {t.subject}</p>
                  <p className="text-xs text-text-muted mt-1 line-clamp-2">{t.body.substring(0, 100)}...</p>
                </div>
                <button className="block-btn text-xs" onClick={() => setEditingTemplate(t)}>Edit</button>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'settings' && (
        <div className="block-card space-y-4 max-w-lg">
          <h3 className="text-sm font-semibold text-text-primary">SMTP Configuration</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">SMTP Host</label>
              <input className="block-input" placeholder="smtp.gmail.com" value={smtpConfig.host} onChange={(e) => setSmtpConfig({ ...smtpConfig, host: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Port</label>
              <input className="block-input" placeholder="587" value={smtpConfig.port} onChange={(e) => setSmtpConfig({ ...smtpConfig, port: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Username</label>
              <input className="block-input" value={smtpConfig.username} onChange={(e) => setSmtpConfig({ ...smtpConfig, username: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Password</label>
              <input className="block-input" type="password" value={smtpConfig.password} onChange={(e) => setSmtpConfig({ ...smtpConfig, password: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">From Name</label>
              <input className="block-input" placeholder="Your Business" value={smtpConfig.from_name} onChange={(e) => setSmtpConfig({ ...smtpConfig, from_name: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">From Email</label>
              <input className="block-input" placeholder="billing@yourbusiness.com" value={smtpConfig.from_email} onChange={(e) => setSmtpConfig({ ...smtpConfig, from_email: e.target.value })} />
            </div>
          </div>
          <button className="block-btn-primary" onClick={saveSmtpConfig}>Save SMTP Settings</button>
        </div>
      )}
    </div>
  );
}

function FileText(props: any) {
  return <Mail {...props} />;
}
