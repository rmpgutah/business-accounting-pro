import React, { useState, useEffect, useCallback } from 'react';
import { Plug, Key, Webhook, Copy, CheckCircle, RefreshCw, Save } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

const WEBHOOK_EVENTS = ['invoice.created', 'invoice.paid', 'expense.created', 'payment.received'];

export default function ApiModule() {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [apiKey, setApiKey] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookEvents, setWebhookEvents] = useState<string[]>([]);
  const [webhookSaved, setWebhookSaved] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      // Load API key
      const keyRows = await api.rawQuery("SELECT value FROM settings WHERE key = 'api_key' LIMIT 1");
      if (keyRows && keyRows.length > 0) {
        setApiKey(keyRows[0].value);
      } else if (activeCompany) {
        // Generate and save a new key
        const newKey = 'bap_' + crypto.randomUUID().replace(/-/g, '');
        await api.create('settings', { company_id: activeCompany.id, key: 'api_key', value: newKey });
        setApiKey(newKey);
      }

      // Load webhook URL
      const urlRows = await api.rawQuery("SELECT value FROM settings WHERE key = 'webhook_url' LIMIT 1");
      if (urlRows && urlRows.length > 0) {
        setWebhookUrl(urlRows[0].value);
      }

      // Load webhook events
      const evtRows = await api.rawQuery("SELECT value FROM settings WHERE key = 'webhook_events' LIMIT 1");
      if (evtRows && evtRows.length > 0) {
        try {
          setWebhookEvents(JSON.parse(evtRows[0].value));
        } catch { /* invalid JSON, ignore */ }
      }
    } catch (err) {
      console.error('Failed to load API settings:', err);
    } finally {
      setLoading(false);
    }
  }, [activeCompany]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const copyKey = () => {
    navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const regenerateKey = async () => {
    if (!activeCompany) return;
    try {
      const newKey = 'bap_' + crypto.randomUUID().replace(/-/g, '');
      const existing = await api.rawQuery("SELECT id FROM settings WHERE key = 'api_key' LIMIT 1");
      if (existing && existing.length > 0) {
        await api.update('settings', existing[0].id, { value: newKey });
      } else {
        await api.create('settings', { company_id: activeCompany.id, key: 'api_key', value: newKey });
      }
      setApiKey(newKey);
    } catch (err) {
      console.error('Failed to regenerate API key:', err);
    }
  };

  const toggleEvent = (event: string) => {
    setWebhookEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  };

  const saveWebhookConfig = async () => {
    if (!activeCompany) return;
    try {
      // Save webhook URL
      const urlRows = await api.rawQuery("SELECT id FROM settings WHERE key = 'webhook_url' LIMIT 1");
      if (urlRows && urlRows.length > 0) {
        await api.update('settings', urlRows[0].id, { value: webhookUrl });
      } else {
        await api.create('settings', { company_id: activeCompany.id, key: 'webhook_url', value: webhookUrl });
      }

      // Save webhook events
      const evtRows = await api.rawQuery("SELECT id FROM settings WHERE key = 'webhook_events' LIMIT 1");
      const eventsJson = JSON.stringify(webhookEvents);
      if (evtRows && evtRows.length > 0) {
        await api.update('settings', evtRows[0].id, { value: eventsJson });
      } else {
        await api.create('settings', { company_id: activeCompany.id, key: 'webhook_events', value: eventsJson });
      }

      setWebhookSaved(true);
      setTimeout(() => setWebhookSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save webhook config:', err);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <span className="text-text-muted text-sm">Loading API settings...</span>
      </div>
    );
  }

  return (
    <div>
      <div className="module-header">
        <h1 className="module-title">API & Integrations</h1>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          {/* API Key */}
          <div className="block-card space-y-3">
            <div className="flex items-center gap-2">
              <Key size={16} className="text-accent-blue" />
              <h3 className="text-sm font-semibold">API Key</h3>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-bg-primary border border-border-primary text-text-secondary text-xs font-mono" style={{ borderRadius: '2px' }}>
                {apiKey}
              </code>
              <button className="block-btn flex items-center gap-1" onClick={copyKey}>
                {copied ? <CheckCircle size={14} className="text-accent-income" /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button className="block-btn flex items-center gap-1 text-xs" onClick={regenerateKey}>
                <RefreshCw size={12} />
                Regenerate
              </button>
            </div>
            <p className="text-xs text-text-muted">Include in requests as: Authorization: Bearer {'<api_key>'}</p>
          </div>

          {/* Webhooks */}
          <div className="block-card space-y-3">
            <div className="flex items-center gap-2">
              <Webhook size={16} className="text-accent-blue" />
              <h3 className="text-sm font-semibold">Webhooks</h3>
            </div>
            <p className="text-xs text-text-muted">Configure webhook URLs to receive notifications when data changes.</p>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Webhook URL</label>
              <input
                className="block-input"
                placeholder="https://your-server.com/webhook"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {WEBHOOK_EVENTS.map((event) => (
                <label key={event} className="flex items-center gap-1.5 text-xs text-text-secondary">
                  <input
                    type="checkbox"
                    className="accent-accent-blue"
                    checked={webhookEvents.includes(event)}
                    onChange={() => toggleEvent(event)}
                  />
                  {event}
                </label>
              ))}
            </div>
            <button className="block-btn-primary text-xs flex items-center gap-1" onClick={saveWebhookConfig}>
              {webhookSaved ? <CheckCircle size={12} className="text-white" /> : <Save size={12} />}
              {webhookSaved ? 'Saved' : 'Save Webhook'}
            </button>
          </div>
        </div>

        {/* IPC / Plugin System Note */}
        <div className="block-card space-y-4">
          <div className="flex items-center gap-2">
            <Plug size={16} className="text-accent-blue" />
            <h3 className="text-sm font-semibold">Data Access</h3>
          </div>
          <p className="text-sm text-text-secondary">
            The Business Accounting Pro API is accessible via the IPC bridge and plugin system.
            All database tables can be queried, created, updated, and deleted through the IPC channels.
          </p>
          <div className="bg-bg-primary border border-border-primary p-4 space-y-2" style={{ borderRadius: '2px' }}>
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">Available IPC Channels</p>
            <div className="space-y-1">
              {[
                { channel: 'db:query', desc: 'Query records with filters and sorting' },
                { channel: 'db:create', desc: 'Insert a new record' },
                { channel: 'db:update', desc: 'Update an existing record' },
                { channel: 'db:delete', desc: 'Delete a record' },
                { channel: 'db:rawQuery', desc: 'Execute raw SQL (read-only)' },
              ].map((item) => (
                <div key={item.channel} className="flex items-center gap-3 py-1.5 border-b border-border-primary last:border-0">
                  <code className="text-xs font-mono text-accent-blue">{item.channel}</code>
                  <span className="text-xs text-text-muted">{item.desc}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs text-text-muted">
            Use your API key for authentication when building plugins or external integrations.
            Webhook events will be dispatched to the configured URL when data changes occur.
          </p>
        </div>
      </div>
    </div>
  );
}
