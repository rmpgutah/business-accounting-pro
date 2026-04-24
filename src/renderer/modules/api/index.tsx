import React, { useState, useEffect, useCallback } from 'react';
import { Plug, Key, Webhook, Copy, CheckCircle, RefreshCw, Save } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import ErrorBanner from '../../components/ErrorBanner';

const WEBHOOK_EVENTS = ['invoice.created', 'invoice.paid', 'expense.created', 'payment.received'];

export default function ApiModule() {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [apiKey, setApiKey] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookEvents, setWebhookEvents] = useState<string[]>([]);
  const [webhookSaved, setWebhookSaved] = useState(false);
  const [error, setError] = useState('');

  const loadSettings = useCallback(async () => {
    if (!activeCompany) return;
    setError('');
    try {
      // Bug fix: replace unscoped rawQuery on settings with scoped getSetting.
      const storedKey = await api.getSetting('api_key');
      if (storedKey) {
        setApiKey(storedKey);
      } else {
        // Generate and save a new key scoped to this company.
        const newKey = 'bap_' + crypto.randomUUID().replace(/-/g, '');
        await api.setSetting('api_key', newKey);
        setApiKey(newKey);
      }

      const storedUrl = await api.getSetting('webhook_url');
      if (storedUrl) setWebhookUrl(storedUrl);

      const storedEvts = await api.getSetting('webhook_events');
      if (storedEvts) {
        try {
          setWebhookEvents(JSON.parse(storedEvts));
        } catch { /* invalid JSON, ignore */ }
      }
    } catch (err: any) {
      console.error('Failed to load API settings:', err);
      setError(err?.message || 'Failed to load API settings');
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
      await api.setSetting('api_key', newKey);
      setApiKey(newKey);
    } catch (err: any) {
      console.error('Failed to regenerate API key:', err);
      alert('Failed to regenerate API key: ' + (err?.message || 'Unknown error'));
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
      await api.setSetting('webhook_url', webhookUrl);
      await api.setSetting('webhook_events', JSON.stringify(webhookEvents));
      setWebhookSaved(true);
      setTimeout(() => setWebhookSaved(false), 2000);
    } catch (err: any) {
      console.error('Failed to save webhook config:', err);
      alert('Failed to save webhook config: ' + (err?.message || 'Unknown error'));
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
      {error && <ErrorBanner message={error} title="Failed to load API settings" onDismiss={() => setError('')} />}

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          {/* API Key */}
          <div className="block-card space-y-3">
            <div className="flex items-center gap-2">
              <Key size={16} className="text-accent-blue" />
              <h3 className="text-sm font-semibold">API Key</h3>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-bg-primary border border-border-primary text-text-secondary text-xs font-mono" style={{ borderRadius: '6px' }}>
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
          <div className="bg-bg-primary border border-border-primary p-4 space-y-2" style={{ borderRadius: '6px' }}>
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
