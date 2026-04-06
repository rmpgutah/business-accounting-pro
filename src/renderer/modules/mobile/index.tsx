import React, { useState, useEffect, useCallback } from 'react';
import { Smartphone, Settings, Save, CheckCircle, Info } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

export default function MobileModule() {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [port, setPort] = useState('3847');
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      // Bug fix: use scoped getSetting instead of unscoped rawQuery on settings.
      const value = await api.getSetting('mobile_port');
      if (value) setPort(value);
    } catch { /* use default */ }
    finally {
      setLoading(false);
    }
  }, [activeCompany]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const savePort = async () => {
    if (!activeCompany) return;
    try {
      await api.setSetting('mobile_port', port);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save mobile port:', err);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <span className="text-text-muted text-sm">Loading mobile settings...</span>
      </div>
    );
  }

  return (
    <div>
      <div className="module-header">
        <h1 className="module-title">Mobile Companion</h1>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          {/* Status */}
          <div className="block-card space-y-3">
            <div className="flex items-center gap-2">
              <Smartphone size={16} className="text-accent-blue" />
              <h3 className="text-sm font-semibold">Mobile Web Interface</h3>
            </div>
            <div className="bg-bg-primary border border-border-primary p-3 flex items-start gap-2" style={{ borderRadius: '6px' }}>
              <Info size={14} className="text-accent-blue mt-0.5 shrink-0" />
              <p className="text-xs text-text-secondary">
                The mobile companion is available when running the optional web server.
                Devices on the same network can access a lightweight interface for expense entry,
                time tracking, and dashboard viewing.
              </p>
            </div>
          </div>

          {/* Port Configuration */}
          <div className="block-card space-y-3">
            <div className="flex items-center gap-2">
              <Settings size={16} className="text-accent-blue" />
              <h3 className="text-sm font-semibold">Server Configuration</h3>
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
                Port
              </label>
              <input
                className="block-input"
                type="number"
                min="1024"
                max="65535"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="3847"
              />
              <p className="text-xs text-text-muted mt-1">
                Default: 3847. The companion server will listen on this port.
              </p>
            </div>
            <button className="block-btn-primary text-xs flex items-center gap-1" onClick={savePort}>
              {saved ? <CheckCircle size={12} className="text-white" /> : <Save size={12} />}
              {saved ? 'Saved' : 'Save Configuration'}
            </button>
          </div>
        </div>

        {/* Instructions */}
        <div className="block-card space-y-4">
          <h3 className="text-sm font-semibold">How to Start</h3>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <span className="w-5 h-5 flex items-center justify-center bg-accent-blue text-white text-xs font-bold shrink-0" style={{ borderRadius: '6px' }}>1</span>
              <p className="text-xs text-text-secondary">
                Go to <span className="text-text-primary font-medium">Settings &gt; Integrations</span> and enable the companion web server.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <span className="w-5 h-5 flex items-center justify-center bg-accent-blue text-white text-xs font-bold shrink-0" style={{ borderRadius: '6px' }}>2</span>
              <p className="text-xs text-text-secondary">
                The server will start on port <code className="text-accent-blue font-mono">{port}</code>.
                Your local network address will be shown in the settings panel.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <span className="w-5 h-5 flex items-center justify-center bg-accent-blue text-white text-xs font-bold shrink-0" style={{ borderRadius: '6px' }}>3</span>
              <p className="text-xs text-text-secondary">
                Open the displayed URL on your phone or tablet browser. Both devices must be on the same network.
              </p>
            </div>
          </div>

          <div className="bg-bg-primary border border-border-primary p-3" style={{ borderRadius: '6px' }}>
            <p className="text-xs text-text-muted">
              Start the companion server via <span className="text-text-primary font-medium">Settings &gt; Integrations</span>.
              A QR code will be generated once the server is running.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
