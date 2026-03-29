import React, { useState } from 'react';
import { Plug, Key, Globe, Webhook, Copy, CheckCircle } from 'lucide-react';

export default function ApiModule() {
  const [apiKey] = useState('bap_' + Math.random().toString(36).substring(2, 15));
  const [copied, setCopied] = useState(false);

  const copyKey = () => {
    navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const endpoints = [
    { method: 'GET', path: '/api/clients', description: 'List all clients' },
    { method: 'POST', path: '/api/clients', description: 'Create a client' },
    { method: 'GET', path: '/api/invoices', description: 'List all invoices' },
    { method: 'POST', path: '/api/invoices', description: 'Create an invoice' },
    { method: 'GET', path: '/api/expenses', description: 'List all expenses' },
    { method: 'POST', path: '/api/expenses', description: 'Create an expense' },
    { method: 'GET', path: '/api/time-entries', description: 'List time entries' },
    { method: 'POST', path: '/api/time-entries', description: 'Create time entry' },
    { method: 'GET', path: '/api/projects', description: 'List all projects' },
    { method: 'GET', path: '/api/reports/pnl', description: 'Profit & Loss report' },
    { method: 'GET', path: '/api/reports/balance-sheet', description: 'Balance Sheet' },
  ];

  return (
    <div>
      <div className="module-header">
        <h1 className="module-title">API & Integrations</h1>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
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
            <p className="text-xs text-text-muted">Include in requests as: Authorization: Bearer {'<api_key>'}</p>
          </div>

          <div className="block-card space-y-3">
            <div className="flex items-center gap-2">
              <Globe size={16} className="text-accent-blue" />
              <h3 className="text-sm font-semibold">API Base URL</h3>
            </div>
            <code className="block px-3 py-2 bg-bg-primary border border-border-primary text-text-secondary text-xs font-mono" style={{ borderRadius: '2px' }}>
              http://localhost:3847/api
            </code>
            <p className="text-xs text-text-muted">API server runs when the application is open</p>
          </div>

          <div className="block-card space-y-3">
            <div className="flex items-center gap-2">
              <Webhook size={16} className="text-accent-blue" />
              <h3 className="text-sm font-semibold">Webhooks</h3>
            </div>
            <p className="text-xs text-text-muted">Configure webhook URLs to receive notifications when data changes.</p>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Webhook URL</label>
              <input className="block-input" placeholder="https://your-server.com/webhook" />
            </div>
            <div className="flex flex-wrap gap-2">
              {['invoice.created', 'invoice.paid', 'expense.created', 'payment.received'].map((event) => (
                <label key={event} className="flex items-center gap-1.5 text-xs text-text-secondary">
                  <input type="checkbox" className="accent-accent-blue" />
                  {event}
                </label>
              ))}
            </div>
            <button className="block-btn-primary text-xs">Save Webhook</button>
          </div>
        </div>

        <div className="block-card">
          <h3 className="text-sm font-semibold mb-4">API Endpoints</h3>
          <div className="space-y-2">
            {endpoints.map((ep, i) => (
              <div key={i} className="flex items-center gap-3 py-2 border-b border-border-primary last:border-0">
                <span
                  className={`text-[10px] font-bold uppercase w-12 text-center py-0.5 ${
                    ep.method === 'GET' ? 'block-badge-income' : 'block-badge-blue'
                  }`}
                >
                  {ep.method}
                </span>
                <code className="text-xs font-mono text-text-primary flex-1">{ep.path}</code>
                <span className="text-xs text-text-muted">{ep.description}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
