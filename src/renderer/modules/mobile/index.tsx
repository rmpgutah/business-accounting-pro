import React, { useState } from 'react';
import { Smartphone, Wifi, QrCode, ExternalLink, CheckCircle } from 'lucide-react';

export default function MobileModule() {
  const [enabled, setEnabled] = useState(false);

  return (
    <div>
      <div className="module-header">
        <h1 className="module-title">Mobile Companion</h1>
        <div className="module-actions">
          <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="accent-accent-blue"
            />
            Enable Mobile Access
          </label>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="block-card">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 flex items-center justify-center bg-accent-blue-bg" style={{ borderRadius: '2px' }}>
                <Smartphone size={20} className="text-accent-blue" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Mobile Web Interface</h3>
                <p className="text-xs text-text-muted mt-1">
                  Access a lightweight version of Business Accounting Pro from your phone or tablet.
                  Works on any device with a web browser on the same network.
                </p>
              </div>
            </div>
          </div>

          <div className="block-card space-y-3">
            <div className="flex items-center gap-2">
              <Wifi size={16} className="text-accent-blue" />
              <h3 className="text-sm font-semibold">Connection</h3>
            </div>
            <div className={`flex items-center gap-2 ${enabled ? 'text-accent-income' : 'text-text-muted'}`}>
              <div className="w-2 h-2" style={{ borderRadius: '50%', background: enabled ? '#22c55e' : '#6b6b6b' }} />
              <span className="text-xs">{enabled ? 'Mobile server running' : 'Mobile server offline'}</span>
            </div>
            {enabled && (
              <div className="mt-2">
                <p className="text-xs text-text-muted mb-1">Open this URL on your phone:</p>
                <code className="block px-3 py-2 bg-bg-primary border border-border-primary text-accent-blue text-sm font-mono" style={{ borderRadius: '2px' }}>
                  http://192.168.1.100:3847/mobile
                </code>
              </div>
            )}
          </div>

          <div className="block-card space-y-3">
            <h3 className="text-sm font-semibold">Features Available on Mobile</h3>
            <div className="space-y-2">
              {[
                'Quick expense entry with receipt camera',
                'Start/stop time tracking',
                'View dashboard and KPIs',
                'Approve pending transactions',
                'View client and project details',
                'Check invoice status',
              ].map((feature, i) => (
                <div key={i} className="flex items-center gap-2">
                  <CheckCircle size={14} className="text-accent-income" />
                  <span className="text-xs text-text-secondary">{feature}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="block-card flex flex-col items-center justify-center" style={{ minHeight: '300px' }}>
          <div className="w-48 h-48 bg-bg-primary border border-border-primary flex items-center justify-center mb-4" style={{ borderRadius: '2px' }}>
            <QrCode size={80} className="text-text-muted" />
          </div>
          <p className="text-xs text-text-muted">
            {enabled ? 'Scan QR code to open on your device' : 'Enable mobile access to generate QR code'}
          </p>
        </div>
      </div>
    </div>
  );
}
