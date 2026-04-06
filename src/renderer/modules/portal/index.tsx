import React, { useState, useEffect } from 'react';
import { Globe, Link, Copy, CheckCircle, ExternalLink, Users } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

export default function PortalModule() {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [clients, setClients] = useState<any[]>([]);
  const [portalEnabled, setPortalEnabled] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    loadClients();
  }, [activeCompany]);

  const loadClients = async () => {
    if (!activeCompany) return;
    try {
      const data = await api.query('clients', { company_id: activeCompany.id, status: 'active' });
      setClients(data);
    } catch { /* empty */ }
  };

  const generateToken = async (clientId: string) => {
    const token = crypto.randomUUID();
    await api.update('clients', clientId, { portal_token: token });
    loadClients();
  };

  const copyLink = (token: string) => {
    const link = `http://localhost:3847/portal/${token}`;
    navigator.clipboard.writeText(link);
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div>
      <div className="module-header">
        <h1 className="module-title">Client Portal</h1>
        <div className="module-actions">
          <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={portalEnabled}
              onChange={(e) => setPortalEnabled(e.target.checked)}
              className="accent-accent-blue"
            />
            Portal Active
          </label>
        </div>
      </div>

      <div className="block-card mb-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 flex items-center justify-center bg-accent-blue-bg" style={{ borderRadius: '6px' }}>
            <Globe size={20} className="text-accent-blue" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Client Portal</h3>
            <p className="text-xs text-text-muted mt-1">
              Give clients access to view their invoices, download PDFs, and upload documents.
              Each client gets a unique, secure link — no passwords required.
            </p>
            <p className="text-xs text-text-muted mt-1">
              Portal URL: <code className="text-accent-blue">http://localhost:3847/portal/{'<token>'}</code>
            </p>
            <div className="flex items-center gap-2 mt-2">
              <div className={`w-2 h-2 ${portalEnabled ? 'bg-accent-income' : 'bg-text-muted'}`} style={{ borderRadius: '50%' }} />
              <span className="text-xs text-text-secondary">{portalEnabled ? 'Portal is running' : 'Portal is offline'}</span>
            </div>
          </div>
        </div>
      </div>

      {clients.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Users size={24} className="text-text-muted" />
          </div>
          <p className="text-text-secondary text-sm">No active clients</p>
          <p className="text-text-muted text-xs mt-1">Add clients first, then generate portal access links</p>
        </div>
      ) : (
        <table className="block-table">
          <thead>
            <tr>
              <th>Client</th>
              <th>Email</th>
              <th>Portal Access</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => (
              <tr key={client.id}>
                <td className="text-text-primary font-medium">{client.name}</td>
                <td className="text-text-secondary">{client.email}</td>
                <td>
                  {client.portal_token ? (
                    <span className="block-badge-income">Active</span>
                  ) : (
                    <span className="block-badge text-text-muted bg-bg-tertiary">No access</span>
                  )}
                </td>
                <td>
                  <div className="flex items-center gap-2">
                    {client.portal_token ? (
                      <button
                        className="block-btn text-xs flex items-center gap-1"
                        onClick={() => copyLink(client.portal_token)}
                      >
                        {copied === client.portal_token ? (
                          <><CheckCircle size={12} className="text-accent-income" /> Copied</>
                        ) : (
                          <><Copy size={12} /> Copy Link</>
                        )}
                      </button>
                    ) : (
                      <button
                        className="block-btn-primary text-xs flex items-center gap-1"
                        onClick={() => generateToken(client.id)}
                      >
                        <Link size={12} /> Generate Link
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
