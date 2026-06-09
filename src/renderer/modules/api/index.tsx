import React, { useState, useEffect, useCallback } from 'react';
import { Plug, Key, Webhook, Copy, CheckCircle, RefreshCw, Save, Cloud, Eye, EyeOff, AlertTriangle } from 'lucide-react';
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

  // Cloud Sync state. The URL points at the Cloudflare Worker (or any
  // compatible BAP cloud endpoint); the token is the DESKTOP_SYNC_TOKEN
  // generated on the cloud side and verified by /api/sync/* there.
  // Token is masked by default so a screenshot of the settings page doesn't
  // leak the bearer credential.
  const [cloudUrl, setCloudUrl] = useState('');
  const [cloudToken, setCloudToken] = useState('');
  const [cloudSaved, setCloudSaved] = useState(false);
  const [cloudTokenVisible, setCloudTokenVisible] = useState(false);
  const [cloudTesting, setCloudTesting] = useState(false);
  const [cloudTestResult, setCloudTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

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

      // Cloud sync settings (separate from the outgoing webhook URL).
      const storedCloudUrl = await api.getSetting('cloud_sync_url');
      if (storedCloudUrl) setCloudUrl(storedCloudUrl);
      const storedCloudToken = await api.getSetting('cloud_sync_token');
      if (storedCloudToken) setCloudToken(storedCloudToken);
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

  // ─── Cloud Sync handlers ─────────────────────────────────
  const saveCloudSync = async () => {
    if (!activeCompany) return;
    try {
      // Trim the URL and strip a trailing slash so '/api/sync/push' joins
      // cleanly. Trim the token to drop any whitespace from paste.
      const cleanUrl = cloudUrl.trim().replace(/\/$/, '');
      await api.setSetting('cloud_sync_url', cleanUrl);
      await api.setSetting('cloud_sync_token', cloudToken.trim());
      setCloudUrl(cleanUrl);
      setCloudToken(cloudToken.trim());
      setCloudSaved(true);
      setTimeout(() => setCloudSaved(false), 2000);
    } catch (err: any) {
      alert('Failed to save cloud sync settings: ' + (err?.message || 'Unknown error'));
    }
  };

  const testCloudConnection = async () => {
    setCloudTesting(true);
    setCloudTestResult(null);
    try {
      const url = cloudUrl.trim().replace(/\/$/, '') + '/api/health';
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + cloudToken.trim() },
      });
      if (res.ok) {
        setCloudTestResult({ ok: true, msg: 'Connected — HTTP ' + res.status });
      } else if (res.status === 401 || res.status === 403) {
        setCloudTestResult({ ok: false, msg: 'Reached server but token rejected (' + res.status + '). Re-check the DESKTOP_SYNC_TOKEN on the cloud side.' });
      } else {
        setCloudTestResult({ ok: false, msg: 'Server responded with HTTP ' + res.status });
      }
    } catch (err: any) {
      setCloudTestResult({ ok: false, msg: 'Could not reach server: ' + (err?.message || 'unknown error') });
    } finally {
      setCloudTesting(false);
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
              {/* Catch the common foot-gun: a bare token pasted here. URLs
                  start with http(s):// and contain '/'; tokens are usually
                  all-hex or all-base64. */}
              {webhookUrl && !/^https?:\/\//i.test(webhookUrl.trim()) && webhookUrl.trim().length > 20 && (
                <p className="text-xs mt-1 flex items-center gap-1 text-accent-warning">
                  <AlertTriangle size={12} />
                  That doesn't look like a URL — did you mean to paste a token into Cloud Sync below?
                </p>
              )}
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

          {/* Cloud Sync — separate from Webhooks. URL is where the desktop
              PUSHES data; Token is the bearer credential the cloud verifies
              against its own DESKTOP_SYNC_TOKEN secret. Token is masked by
              default so screenshots of this screen don't leak the credential. */}
          <div className="block-card space-y-3">
            <div className="flex items-center gap-2">
              <Cloud size={16} className="text-accent-blue" />
              <h3 className="text-sm font-semibold">Cloud Sync</h3>
            </div>
            <p className="text-xs text-text-muted">
              Push data to the BAP cloud companion (e.g. https://accounting.rmpgutah.us)
              so the web app and client portal see the same records as the desktop.
            </p>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Sync URL</label>
              <input
                className="block-input"
                placeholder="https://accounting.rmpgutah.us"
                value={cloudUrl}
                onChange={(e) => setCloudUrl(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Sync Token</label>
              <div className="flex items-center gap-2">
                <input
                  className="block-input flex-1 font-mono text-xs"
                  type={cloudTokenVisible ? 'text' : 'password'}
                  placeholder="DESKTOP_SYNC_TOKEN from the cloud Worker"
                  value={cloudToken}
                  onChange={(e) => setCloudToken(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button type="button" className="block-btn flex items-center gap-1 text-xs"
                  onClick={() => setCloudTokenVisible(v => !v)}
                  title={cloudTokenVisible ? 'Hide token' : 'Show token'}>
                  {cloudTokenVisible ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
              <p className="text-xs text-text-muted mt-1">
                Set on the cloud side with <code className="font-mono">wrangler secret put DESKTOP_SYNC_TOKEN</code>.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button className="block-btn-primary text-xs flex items-center gap-1" onClick={saveCloudSync}
                disabled={!cloudUrl.trim() || !cloudToken.trim()}>
                {cloudSaved ? <CheckCircle size={12} className="text-white" /> : <Save size={12} />}
                {cloudSaved ? 'Saved' : 'Save Cloud Sync'}
              </button>
              <button className="block-btn text-xs flex items-center gap-1" onClick={testCloudConnection}
                disabled={!cloudUrl.trim() || !cloudToken.trim() || cloudTesting}
                title="GET /api/health with your token to verify the cloud accepts the credential">
                <RefreshCw size={12} className={cloudTesting ? 'animate-spin' : ''} />
                {cloudTesting ? 'Testing...' : 'Test Connection'}
              </button>
            </div>
            {cloudTestResult && (
              <p className={`text-xs flex items-center gap-1 ${cloudTestResult.ok ? 'text-accent-income' : 'text-accent-expense'}`}>
                {cloudTestResult.ok ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
                {cloudTestResult.msg}
              </p>
            )}
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
