// src/renderer/modules/reports/ComplianceDocs.tsx
//
// Compliance Documents (W-4 / W-9 / I-9) — three-pane view:
//   1. Missing Forms — employees / vendors who need to submit
//   2. Expiring Soon — forms expiring within 60 days
//   3. All On File — searchable list with download / replace actions
//
// "Generate Blank PDF" is the headline action: produces a pre-filled
// PDF (employer/payer section filled) for the user to hand to the
// recipient.

import React, { useEffect, useState, useCallback } from 'react';
import { FileText, Download, AlertTriangle, ChevronLeft, Clock, CheckCircle, FilePlus } from 'lucide-react';
import api from '../../lib/api';
import { useToast } from '../../components/ToastProvider';

type FormType = 'W-4' | 'W-9' | 'I-9';
type PaneId = 'missing' | 'expiring' | 'all';

interface Props { onBack?: () => void }

const ComplianceDocs: React.FC<Props> = ({ onBack }) => {
  const toast = useToast();
  const [pane, setPane] = useState<PaneId>('missing');
  const [missing, setMissing] = useState<any[]>([]);
  const [expiring, setExpiring] = useState<any[]>([]);
  const [all, setAll] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState<string>('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // Auto-expire stale forms first
      await api.complianceAutoExpire();
      const [m, e, a] = await Promise.all([
        api.complianceGetMissing(),
        api.complianceGetExpiring(60),
        api.complianceList({ status: 'current' }),
      ]);
      setMissing(Array.isArray(m) ? m : []);
      setExpiring(Array.isArray(e) ? e : []);
      setAll(Array.isArray(a) ? a : []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleGenerateBlank = async (formType: FormType, personType?: 'employee' | 'vendor' | 'client', personId?: string) => {
    setGenerating(formType + ':' + (personId || ''));
    try {
      const r = await api.complianceGenerateBlankPDF(formType, personType, personId);
      if (r?.error) toast.error('Generation failed: ' + r.error);
      else if (r?.cancelled) {/* user cancelled */}
      else if (r?.path) toast.success('Pre-filled blank saved to ' + r.path);
    } finally { setGenerating(''); }
  };

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        {onBack && (
          <button onClick={onBack} className="block-btn flex items-center gap-1.5 text-xs">
            <ChevronLeft size={12} /> Back
          </button>
        )}
        <h2 style={{ fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
          <FileText size={22} /> Compliance Documents · W-4 / W-9 / I-9
        </h2>
      </div>

      {/* Quick-action: generate blank PDF */}
      <div className="block-card" style={{ padding: 14, marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
          Generate a pre-filled blank PDF
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {(['W-4', 'W-9', 'I-9'] as FormType[]).map((ft) => (
            <button
              key={ft}
              onClick={() => handleGenerateBlank(ft)}
              disabled={generating === ft + ':'}
              className="block-btn flex items-center gap-1.5 text-xs"
              style={{ padding: '8px 14px' }}
            >
              <FilePlus size={12} /> {generating === ft + ':' ? 'Generating…' : 'New blank ' + ft}
            </button>
          ))}
          <div style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--color-text-muted)', alignSelf: 'center' }}>
            Generates a PDF with your company info pre-filled. Hand to the new hire / vendor for signature.
          </div>
        </div>
      </div>

      {/* Tab pane selector */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--color-border-primary)' }}>
        {([
          { id: 'missing' as PaneId, label: 'Missing Forms', count: missing.length, icon: AlertTriangle, color: '#dc2626' },
          { id: 'expiring' as PaneId, label: 'Expiring Soon', count: expiring.length, icon: Clock, color: '#d97706' },
          { id: 'all' as PaneId, label: 'On File', count: all.length, icon: CheckCircle, color: '#16a34a' },
        ]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setPane(tab.id)}
            style={{
              padding: '10px 16px',
              background: 'transparent',
              border: 'none',
              borderBottom: '2px solid ' + (pane === tab.id ? 'var(--color-accent-blue)' : 'transparent'),
              color: pane === tab.id ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <tab.icon size={12} style={{ color: tab.color }} /> {tab.label}
            {tab.count > 0 && (
              <span style={{ background: tab.color, color: '#fff', fontSize: 10, padding: '2px 6px', borderRadius: 8, fontWeight: 800 }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
        <button onClick={refresh} disabled={loading} className="block-btn text-xs" style={{ marginLeft: 'auto', padding: '6px 10px' }}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {pane === 'missing' && <MissingPane rows={missing} onGenerate={handleGenerateBlank} generating={generating} />}
      {pane === 'expiring' && <ExpiringPane rows={expiring} />}
      {pane === 'all' && <AllPane rows={all} />}

      <div style={{
        marginTop: 16, padding: 12,
        border: '1px dashed var(--color-border-primary)',
        background: 'rgba(217, 119, 6, 0.05)',
        borderRadius: 6, fontSize: 11, color: 'var(--color-text-muted)',
      }}>
        <strong>Compliance reminders:</strong> W-4 is collected at hire and refreshed when an employee has a life event. W-9 should be re-verified annually for active 1099 vendors. I-9 must be on file within 3 business days of the employee's first day, and retained for 3 years after hire OR 1 year after termination — whichever is later.
      </div>
    </div>
  );
};

// ── Missing Forms pane ─────────────────────────────────────────

const MissingPane: React.FC<{ rows: any[]; onGenerate: (ft: 'W-4' | 'W-9' | 'I-9', pt?: any, pid?: string) => void; generating: string }> = ({ rows, onGenerate, generating }) => {
  if (rows.length === 0) {
    return <div className="block-card" style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>
      <CheckCircle size={32} style={{ color: '#16a34a', margin: '0 auto 8px' }} />
      <div>All required compliance forms are on file. Nice work.</div>
    </div>;
  }
  return (
    <div className="block-card" style={{ padding: 0, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border-primary)' }}>
            {['Person', 'Type', 'Missing', 'Hire Date', 'Days Overdue', 'Action'].map((h, i) => (
              <th key={h} style={{ padding: '10px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800, color: 'var(--color-text-muted)', textAlign: i === 4 ? 'right' : 'left' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r: any, i: number) => (
            <tr key={r.person_id + ':' + i} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
              <td style={{ padding: '8px 10px', fontSize: 12, fontWeight: 600 }}>{r.person_name || '(unnamed)'}</td>
              <td style={{ padding: '8px 10px', fontSize: 11, color: 'var(--color-text-muted)' }}>{r.person_type}</td>
              <td style={{ padding: '8px 10px', fontSize: 11 }}>
                {r.required_forms.map((f: string) => (
                  <span key={f} style={{ display: 'inline-block', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: '#fef2f2', color: '#991b1b', marginRight: 4 }}>{f}</span>
                ))}
              </td>
              <td style={{ padding: '8px 10px', fontSize: 11, color: 'var(--color-text-muted)' }}>{r.hire_date || '—'}</td>
              <td style={{ padding: '8px 10px', fontSize: 11, textAlign: 'right', fontWeight: 700, color: r.days_overdue > 0 ? '#dc2626' : 'var(--color-text-muted)' }}>
                {r.days_overdue > 0 ? r.days_overdue + ' days' : '—'}
              </td>
              <td style={{ padding: '8px 10px', fontSize: 11 }}>
                {r.required_forms.map((f: string) => (
                  <button
                    key={f}
                    onClick={() => onGenerate(f as any, r.person_type, r.person_id)}
                    disabled={generating === f + ':' + r.person_id}
                    className="block-btn text-xs"
                    style={{ padding: '4px 8px', marginRight: 4 }}
                  >
                    <Download size={10} style={{ marginRight: 4 }} />
                    {generating === f + ':' + r.person_id ? '…' : f}
                  </button>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ── Expiring Soon pane ─────────────────────────────────────────

const ExpiringPane: React.FC<{ rows: any[] }> = ({ rows }) => {
  if (rows.length === 0) {
    return <div className="block-card" style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>
      <CheckCircle size={32} style={{ color: '#16a34a', margin: '0 auto 8px' }} />
      <div>No forms expiring in the next 60 days.</div>
    </div>;
  }
  return (
    <div className="block-card" style={{ padding: 0, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border-primary)' }}>
            {['Person', 'Form', 'Effective', 'Expires', 'Days Until'].map((h, i) => (
              <th key={h} style={{ padding: '10px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800, color: 'var(--color-text-muted)', textAlign: i === 4 ? 'right' : 'left' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r: any) => {
            const expires = new Date(r.expires_at + 'T00:00:00');
            const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00');
            const daysUntil = Math.round((expires.getTime() - today.getTime()) / 86400000);
            return (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                <td style={{ padding: '8px 10px', fontSize: 12, fontWeight: 600 }}>{r.person_name || '(unnamed)'}</td>
                <td style={{ padding: '8px 10px', fontSize: 11, fontWeight: 700 }}>{r.form_type}</td>
                <td style={{ padding: '8px 10px', fontSize: 11, color: 'var(--color-text-muted)' }}>{r.effective_date || '—'}</td>
                <td style={{ padding: '8px 10px', fontSize: 11, fontWeight: 600 }}>{r.expires_at || '—'}</td>
                <td style={{ padding: '8px 10px', fontSize: 11, textAlign: 'right', fontWeight: 700, color: daysUntil < 14 ? '#dc2626' : daysUntil < 30 ? '#d97706' : 'var(--color-text-muted)' }}>
                  {daysUntil < 0 ? `${-daysUntil} days overdue` : `${daysUntil} days`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// ── All On File pane ───────────────────────────────────────────

const AllPane: React.FC<{ rows: any[] }> = ({ rows }) => {
  if (rows.length === 0) {
    return <div className="block-card" style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>
      No compliance documents on file yet. Use "New blank" buttons above to generate pre-filled forms for your employees and vendors.
    </div>;
  }
  return (
    <div className="block-card" style={{ padding: 0, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border-primary)' }}>
            {['Person', 'Type', 'Form', 'Effective', 'Expires', 'Status'].map((h) => (
              <th key={h} style={{ padding: '10px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800, color: 'var(--color-text-muted)', textAlign: 'left' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r: any) => (
            <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
              <td style={{ padding: '8px 10px', fontSize: 12, fontWeight: 600 }}>{r.person_name || '(unnamed)'}</td>
              <td style={{ padding: '8px 10px', fontSize: 11, color: 'var(--color-text-muted)' }}>{r.person_type}</td>
              <td style={{ padding: '8px 10px', fontSize: 11, fontWeight: 700 }}>{r.form_type}</td>
              <td style={{ padding: '8px 10px', fontSize: 11, color: 'var(--color-text-muted)' }}>{r.effective_date || '—'}</td>
              <td style={{ padding: '8px 10px', fontSize: 11 }}>{r.expires_at || 'Never'}</td>
              <td style={{ padding: '8px 10px', fontSize: 10 }}>
                <span style={{ display: 'inline-block', padding: '2px 6px', borderRadius: 4, fontWeight: 700, background: r.status === 'current' ? '#ecfdf5' : '#fef2f2', color: r.status === 'current' ? '#065f46' : '#991b1b' }}>
                  {(r.status || '').toUpperCase()}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default ComplianceDocs;
