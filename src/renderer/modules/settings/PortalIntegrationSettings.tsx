import React, { useEffect, useState } from 'react';
import { KeyRound, Save, Wifi, AlertTriangle, CheckCircle2, Trash2, ExternalLink } from 'lucide-react';
import api from '../../lib/api';

/**
 * Client Portal Integration — rmpgutahps.us
 *
 * Connects this desktop app to the external client-portal so
 * invoices/quotes/credit-notes shared with clients via QR code or
 * email link route to a live login experience instead of a static
 * page.
 *
 * SECURITY MODEL
 * ──────────────
 * The API key never leaves the OS keychain in plaintext form.
 * • Save  → renderer sends plaintext over IPC, main encrypts via
 *           Electron safeStorage (macOS Keychain / Windows DPAPI),
 *           DB stores ciphertext only.
 * • Read  → main process can decrypt for outbound HTTP calls.
 * • UI    → only ever sees `api_key_set: boolean` — never the value.
 *           To rotate the key, paste a new value (overwrites).
 *           To revoke, hit "Clear API Key" (zeroes the column).
 *
 * This is the same pattern Stripe/GitHub use for webhook secrets.
 */
const PortalIntegrationSettings: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [portalBaseUrl, setPortalBaseUrl] = useState('https://rmpgutahps.us/client/login');
  const [apiEndpoint, setApiEndpoint] = useState('https://rmpgutahps.us/api/v1');
  const [authScheme, setAuthScheme] = useState<'bearer' | 'apikey-header'>('bearer');
  const [autoSyncInvoices, setAutoSyncInvoices] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeySet, setApiKeySet] = useState(false);
  const [lastTest, setLastTest] = useState<{ at?: string; status?: string; message?: string }>({});
  const [savedFlash, setSavedFlash] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.portalIntegrationGet();
      if (res?.error) return;
      setPortalBaseUrl(res.portal_base_url || 'https://rmpgutahps.us/client/login');
      setApiEndpoint(res.api_endpoint || 'https://rmpgutahps.us/api/v1');
      setAuthScheme(res.auth_scheme || 'bearer');
      setAutoSyncInvoices(!!res.auto_sync_invoices);
      setApiKeySet(!!res.api_key_set);
      setLastTest({
        at: res.last_test_at || undefined,
        status: res.last_test_status || undefined,
        message: res.last_test_message || undefined,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: any = {
        portal_base_url: portalBaseUrl,
        api_endpoint: apiEndpoint,
        auth_scheme: authScheme,
        auto_sync_invoices: autoSyncInvoices,
      };
      if (apiKeyInput.trim()) payload.api_key = apiKeyInput.trim();
      const res = await api.portalIntegrationSave(payload);
      if (res?.error) {
        alert(`Save failed: ${res.error}`);
        return;
      }
      setApiKeyInput(''); // never linger plaintext in component state
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleClearKey = async () => {
    if (!confirm('Clear the stored API key? Outbound calls to rmpgutahps.us will fail until a new key is configured.')) return;
    setSaving(true);
    try {
      await api.portalIntegrationSave({ clear_api_key: true });
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await api.portalIntegrationTest();
      setLastTest({
        at: new Date().toISOString(),
        status: res.ok ? 'success' : 'error',
        message: res.ok ? (res.message || 'Connected') : (res.error || res.message || 'Test failed'),
      });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--color-text-muted)' }}>Loading portal integration settings…</div>;
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 800 }}>
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
          <KeyRound size={22} />
          Client Portal Integration
        </h2>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          Connect this app to <strong>rmpgutahps.us</strong> so the QR codes and email links on your invoices route clients to a live login experience.
        </p>
      </div>

      {/* Endpoint configuration */}
      <div className="block-card" style={{ padding: 16 }}>
        <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Endpoints</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Portal Login URL <span style={{ textTransform: 'none', color: 'var(--color-text-muted)' }}>(embedded in QR codes & emails)</span>
            </span>
            <input
              className="block-input"
              value={portalBaseUrl}
              onChange={(e) => setPortalBaseUrl(e.target.value)}
              placeholder="https://rmpgutahps.us/client/login"
            />
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
              Supports {'{token}'} placeholder, /login (appends ?invoice=&lt;token&gt;), or legacy /portal (appends /&lt;token&gt;).
            </span>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              API Endpoint <span style={{ textTransform: 'none', color: 'var(--color-text-muted)' }}>(server-to-server calls)</span>
            </span>
            <input
              className="block-input"
              value={apiEndpoint}
              onChange={(e) => setApiEndpoint(e.target.value)}
              placeholder="https://rmpgutahps.us/api/v1"
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Authentication Scheme
            </span>
            <select
              className="block-input"
              value={authScheme}
              onChange={(e) => setAuthScheme(e.target.value as any)}
            >
              <option value="bearer">Bearer Token (Authorization: Bearer &lt;key&gt;)</option>
              <option value="apikey-header">X-API-Key Header (X-API-Key: &lt;key&gt;)</option>
            </select>
          </label>
        </div>
      </div>

      {/* API key */}
      <div className="block-card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div className="text-xs font-semibold text-text-muted uppercase tracking-wider">API Key</div>
          {apiKeySet ? (
            <span style={{ fontSize: 10, color: 'var(--color-positive)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', display: 'flex', alignItems: 'center', gap: 4 }}>
              <CheckCircle2 size={12} /> Encrypted &amp; stored
            </span>
          ) : (
            <span style={{ fontSize: 10, color: 'var(--color-warning)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', display: 'flex', alignItems: 'center', gap: 4 }}>
              <AlertTriangle size={12} /> Not configured
            </span>
          )}
        </div>
        <input
          className="block-input"
          type="password"
          value={apiKeyInput}
          onChange={(e) => setApiKeyInput(e.target.value)}
          placeholder={apiKeySet ? '•••••••••••••••• (paste new key to rotate)' : 'Paste API key from rmpgutahps.us'}
          style={{ fontFamily: 'SF Mono, Menlo, Consolas, monospace' }}
          autoComplete="off"
          spellCheck={false}
        />
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6, lineHeight: 1.5 }}>
          The key is encrypted via your OS keychain (macOS Keychain / Windows Credential Manager) before being written to disk. The plaintext value is never read back to the UI — to rotate, paste a new value above and click Save.
        </div>
        {apiKeySet && (
          <button
            onClick={handleClearKey}
            className="block-btn"
            style={{ marginTop: 10, fontSize: 11, color: 'var(--color-accent-expense)', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Trash2 size={12} /> Clear API Key
          </button>
        )}
      </div>

      {/* Behavior */}
      <div className="block-card" style={{ padding: 16 }}>
        <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Sync Behavior</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={autoSyncInvoices}
            onChange={(e) => setAutoSyncInvoices(e.target.checked)}
            style={{ width: 16, height: 16 }}
          />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
              Auto-sync invoices on save
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              When enabled, every invoice save pushes metadata (number, total, status, portal_token) to rmpgutahps.us so the client portal stays current.
            </div>
          </div>
        </label>
      </div>

      {/* Test connection */}
      <div className="block-card" style={{ padding: 16 }}>
        <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Connection Health</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button
            onClick={handleTest}
            disabled={testing || !apiKeySet}
            className="block-btn block-btn-primary flex items-center gap-2"
            style={{ opacity: (testing || !apiKeySet) ? 0.5 : 1 }}
          >
            <Wifi size={14} />
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
          {lastTest.at && (
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              {lastTest.status === 'success' ? (
                <CheckCircle2 size={14} style={{ color: 'var(--color-positive)' }} />
              ) : (
                <AlertTriangle size={14} style={{ color: 'var(--color-accent-expense)' }} />
              )}
              <span style={{ fontWeight: 600 }}>{lastTest.message}</span>
              <span style={{ color: 'var(--color-text-muted)' }}>
                · {new Date(lastTest.at).toLocaleString()}
              </span>
            </div>
          )}
          {!apiKeySet && (
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
              Save an API key first
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 10, lineHeight: 1.5 }}>
          Calls <code style={{ background: 'var(--color-bg-secondary)', padding: '1px 6px', borderRadius: 3, fontSize: 10 }}>{apiEndpoint.replace(/\/$/, '')}/ping</code> with the configured auth header. 10-second timeout.
        </div>
      </div>

      {/* Save bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          className="block-btn block-btn-primary flex items-center gap-2"
          style={{ opacity: saving ? 0.6 : 1 }}
        >
          <Save size={14} />
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
        {savedFlash && (
          <span style={{ fontSize: 12, color: 'var(--color-positive)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
            <CheckCircle2 size={14} /> Saved
          </span>
        )}
        <a
          href="https://rmpgutahps.us"
          onClick={(e) => { e.preventDefault(); window.open('https://rmpgutahps.us', '_blank'); }}
          style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}
        >
          Manage portal account <ExternalLink size={11} />
        </a>
      </div>
    </div>
  );
};

export default PortalIntegrationSettings;
