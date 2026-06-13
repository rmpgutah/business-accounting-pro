import React, { useEffect, useState } from 'react';
import { FileSearch, MessageSquare, AlertOctagon, Plus, CheckCircle } from 'lucide-react';
import api from '../../lib/api';
import { formatDate, formatCurrency } from '../../lib/format';
import { useCompanyStore } from '../../stores/companyStore';
import ErrorBanner from '../../components/ErrorBanner';

// ─── Types ────────────────────────────────────────────────
interface AuditSample {
  id: string;
  population_description: string;
  population_size: number;
  sample_size: number;
  sampling_method: string;
  stratification?: string;
  auditor?: string;
  test_date: string;
  created_at: string;
}

interface AuditConfirmation {
  id: string;
  confirmation_type: string;
  third_party_name: string;
  third_party_contact?: string;
  balance_per_books: number;
  balance_confirmed: number;
  confirmation_date?: string;
  sent_date?: string;
  response_received_date?: string;
  discrepancy: number;
  status: string;
  resolution?: string;
  notes?: string;
}

interface AuditorInquiry {
  id: string;
  auditor_firm?: string;
  auditor_contact?: string;
  inquiry_date: string;
  inquiry_subject: string;
  inquiry_text?: string;
  response_text?: string;
  response_date?: string;
  response_by?: string;
  status: string;
}

interface AuditIssue {
  id: string;
  issue_number: string;
  title: string;
  severity: string;
  category?: string;
  description?: string;
  root_cause?: string;
  recommendation?: string;
  assigned_to?: string;
  target_resolution_date?: string;
  status: string;
  resolved_at?: string;
  resolution_notes?: string;
}

// ─── Badge helpers ────────────────────────────────────────
const SEVERITY_BADGE: Record<string, string> = {
  critical: 'block-badge block-badge-expense',
  high: 'block-badge block-badge-expense',
  medium: 'block-badge block-badge-warning',
  low: 'block-badge block-badge-income',
};

const STATUS_BADGE: Record<string, string> = {
  open: 'block-badge block-badge-warning',
  responded: 'block-badge block-badge-income',
  resolved: 'block-badge block-badge-income',
  pending: 'block-badge block-badge-blue',
  confirmed: 'block-badge block-badge-income',
  exception: 'block-badge block-badge-expense',
  'no-response': 'block-badge block-badge-expense',
};

// ─── Sub-tabs ─────────────────────────────────────────────
type SubTab = 'samples' | 'confirmations' | 'inquiries' | 'issues';

// ─── Audit Samples Panel ──────────────────────────────────
interface SamplesPanelProps { companyId: string; }

const SamplesPanel: React.FC<SamplesPanelProps> = ({ companyId }) => {
  const [samples, setSamples] = useState<AuditSample[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [samplesKey, setSamplesKey] = useState(0);
  const [showForm, setShowForm] = useState(false);

  // Form fields
  const [populationDesc, setPopulationDesc] = useState('');
  const [sampleSize, setSampleSize] = useState('25');
  const [method, setMethod] = useState<'random' | 'systematic' | 'stratified'>('random');
  const [auditor, setAuditor] = useState('');
  const [rawItems, setRawItems] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const [lastGenerated, setLastGenerated] = useState<{ id: string; sample_size: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.featAuditSampleList()
      .then((rows: AuditSample[]) => { if (!cancelled) setSamples(Array.isArray(rows) ? rows : []); })
      .catch((e: any) => { if (!cancelled) setError(e?.message || 'Failed to load samples'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [samplesKey]);

  const handleGenerate = async () => {
    if (!populationDesc.trim()) { setGenError('Population description is required.'); return; }
    const size = parseInt(sampleSize, 10);
    if (!size || size < 1) { setGenError('Sample size must be a positive number.'); return; }
    let items: any[] = [];
    if (rawItems.trim()) {
      try {
        items = JSON.parse(rawItems.trim());
        if (!Array.isArray(items)) throw new Error('Items must be a JSON array');
      } catch {
        // treat as line-delimited text
        items = rawItems.split('\n').map(l => l.trim()).filter(Boolean).map((l, i) => ({ index: i + 1, value: l }));
      }
    }
    setGenerating(true);
    try {
      const res = await api.featAuditSampleGenerate({
        population_description: populationDesc.trim(),
        population_items: items,
        sample_size: size,
        method,
        auditor: auditor || undefined,
      });
      if (res?.error) throw new Error(res.error);
      setLastGenerated({ id: res.id, sample_size: res.sample_size });
      setShowForm(false);
      setPopulationDesc(''); setRawItems(''); setAuditor('');
      setSamplesKey(k => k + 1);
    } catch (e: any) {
      setGenError(e?.message || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}
      {lastGenerated && (
        <div className="flex items-center gap-2 p-3 block-card text-sm text-accent-income">
          <CheckCircle size={14} />
          <span>Sample generated — {lastGenerated.sample_size} items selected.</span>
          <button className="ml-auto text-xs text-text-muted hover:text-text-primary" onClick={() => setLastGenerated(null)}>Dismiss</button>
        </div>
      )}
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-text-primary">Audit Samples</p>
        <button className="block-btn block-btn-primary text-xs" onClick={() => setShowForm(v => !v)}>
          <Plus size={12} className="inline mr-1" />{showForm ? 'Cancel' : 'Generate Sample'}
        </button>
      </div>

      {showForm && (
        <div className="block-card p-4 space-y-3">
          {genError && <ErrorBanner message={genError} onDismiss={() => setGenError('')} />}
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Generate Audit Sample</p>
          <div>
            <label className="block text-xs text-text-muted mb-1">Population Description *</label>
            <input className="block-input" value={populationDesc} onChange={e => setPopulationDesc(e.target.value)} placeholder="e.g. Q1 AP invoices over $5,000" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">Sample Size</label>
              <input type="number" className="block-input" value={sampleSize} onChange={e => setSampleSize(e.target.value)} min="1" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Method</label>
              <select className="block-select" value={method} onChange={e => setMethod(e.target.value as 'random' | 'systematic' | 'stratified')}>
                <option value="random">Random</option>
                <option value="systematic">Systematic</option>
                <option value="stratified">Stratified</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Auditor</label>
              <input className="block-input" value={auditor} onChange={e => setAuditor(e.target.value)} placeholder="Name" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Population Items (JSON array or line-per-item; optional)</label>
            <textarea className="block-input min-h-[60px] font-mono text-xs" value={rawItems} onChange={e => setRawItems(e.target.value)} placeholder={'["item1","item2",...] or one item per line'} />
          </div>
          <div className="flex gap-2 justify-end">
            <button className="block-btn block-btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="block-btn block-btn-primary" onClick={handleGenerate} disabled={generating}>
              {generating ? 'Generating...' : 'Generate'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-text-muted">Loading samples...</p>
      ) : samples.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><FileSearch size={22} className="text-text-muted" /></div>
          <p className="text-sm text-text-secondary font-medium">No audit samples yet</p>
          <p className="text-xs text-text-muted mt-1">Generate a sample to begin audit testing.</p>
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden">
          <table className="block-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Population</th>
                <th>Method</th>
                <th>Pop. Size</th>
                <th>Sample Size</th>
                <th>Auditor</th>
              </tr>
            </thead>
            <tbody>
              {samples.map(s => (
                <tr key={s.id}>
                  <td className="font-mono text-xs whitespace-nowrap">{formatDate(s.test_date)}</td>
                  <td className="text-sm text-text-primary max-w-[220px] truncate" title={s.population_description}>{s.population_description}</td>
                  <td><span className="block-badge block-badge-blue capitalize">{s.sampling_method}</span></td>
                  <td className="font-mono text-xs text-right">{s.population_size}</td>
                  <td className="font-mono text-xs text-right">{s.sample_size}</td>
                  <td className="text-text-muted text-xs">{s.auditor || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ─── Confirmations Panel ──────────────────────────────────
interface ConfirmationsPanelProps { companyId: string; }

const ConfirmationsPanel: React.FC<ConfirmationsPanelProps> = ({ companyId: _companyId }) => {
  const [confirmations, setConfirmations] = useState<AuditConfirmation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confKey, setConfKey] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<AuditConfirmation | null>(null);

  // Form
  const [confType, setConfType] = useState('ar');
  const [thirdPartyName, setThirdPartyName] = useState('');
  const [thirdPartyContact, setThirdPartyContact] = useState('');
  const [balancePerBooks, setBalancePerBooks] = useState('');
  const [balanceConfirmed, setBalanceConfirmed] = useState('');
  const [confirmationDate, setConfirmationDate] = useState('');
  const [sentDate, setSentDate] = useState('');
  const [responseDate, setResponseDate] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('pending');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.featAuditConfirmList()
      .then((rows: AuditConfirmation[]) => { if (!cancelled) setConfirmations(Array.isArray(rows) ? rows : []); })
      .catch((e: any) => { if (!cancelled) setError(e?.message || 'Failed to load confirmations'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [confKey]);

  const openForm = (conf?: AuditConfirmation) => {
    setEditTarget(conf || null);
    setConfType(conf?.confirmation_type || 'ar');
    setThirdPartyName(conf?.third_party_name || '');
    setThirdPartyContact(conf?.third_party_contact || '');
    setBalancePerBooks(conf ? String(conf.balance_per_books) : '');
    setBalanceConfirmed(conf ? String(conf.balance_confirmed) : '');
    setConfirmationDate(conf?.confirmation_date || '');
    setSentDate(conf?.sent_date || '');
    setResponseDate(conf?.response_received_date || '');
    setNotes(conf?.notes || '');
    setStatus(conf?.status || 'pending');
    setSaveError('');
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!thirdPartyName.trim()) { setSaveError('Third party name is required.'); return; }
    setSaving(true);
    try {
      const res = await api.featAuditConfirmUpsert({
        id: editTarget?.id,
        confirmation_type: confType,
        third_party_name: thirdPartyName.trim(),
        third_party_contact: thirdPartyContact || null,
        balance_per_books: parseFloat(balancePerBooks) || 0,
        balance_confirmed: parseFloat(balanceConfirmed) || 0,
        confirmation_date: confirmationDate || null,
        sent_date: sentDate || null,
        response_received_date: responseDate || null,
        notes: notes || null,
        status,
      });
      if (res?.error) throw new Error(res.error);
      setShowForm(false);
      setEditTarget(null);
      setConfKey(k => k + 1);
    } catch (e: any) {
      setSaveError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-text-primary">Audit Confirmations</p>
        <button className="block-btn block-btn-primary text-xs" onClick={() => { setShowForm(v => { if (v && !editTarget) return false; return true; }); setEditTarget(null); if (!showForm) openForm(); }}>
          <Plus size={12} className="inline mr-1" />{showForm && !editTarget ? 'Cancel' : 'Add Confirmation'}
        </button>
      </div>

      {showForm && (
        <div className="block-card p-4 space-y-3">
          {saveError && <ErrorBanner message={saveError} onDismiss={() => setSaveError('')} />}
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">{editTarget ? 'Edit' : 'New'} Confirmation</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">Type</label>
              <select className="block-select" value={confType} onChange={e => setConfType(e.target.value)}>
                <option value="ar">Accounts Receivable</option>
                <option value="ap">Accounts Payable</option>
                <option value="bank">Bank</option>
                <option value="inventory">Inventory</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Status</label>
              <select className="block-select" value={status} onChange={e => setStatus(e.target.value)}>
                <option value="pending">Pending</option>
                <option value="confirmed">Confirmed</option>
                <option value="exception">Exception</option>
                <option value="no-response">No Response</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">Third Party Name *</label>
              <input className="block-input" value={thirdPartyName} onChange={e => setThirdPartyName(e.target.value)} placeholder="Company or bank name" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Contact</label>
              <input className="block-input" value={thirdPartyContact} onChange={e => setThirdPartyContact(e.target.value)} placeholder="Email or phone" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">Balance Per Books</label>
              <input type="number" className="block-input" value={balancePerBooks} onChange={e => setBalancePerBooks(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Balance Confirmed</label>
              <input type="number" className="block-input" value={balanceConfirmed} onChange={e => setBalanceConfirmed(e.target.value)} placeholder="0.00" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">Confirmation Date</label>
              <input type="date" className="block-input" value={confirmationDate} onChange={e => setConfirmationDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Sent Date</label>
              <input type="date" className="block-input" value={sentDate} onChange={e => setSentDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Response Received</label>
              <input type="date" className="block-input" value={responseDate} onChange={e => setResponseDate(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Notes</label>
            <textarea className="block-input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional notes..." />
          </div>
          <div className="flex gap-2 justify-end">
            <button className="block-btn block-btn-ghost" onClick={() => { setShowForm(false); setEditTarget(null); }}>Cancel</button>
            <button className="block-btn block-btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-text-muted">Loading confirmations...</p>
      ) : confirmations.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><CheckCircle size={22} className="text-text-muted" /></div>
          <p className="text-sm text-text-secondary font-medium">No confirmations yet</p>
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden">
          <table className="block-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Third Party</th>
                <th>Per Books</th>
                <th>Confirmed</th>
                <th>Discrepancy</th>
                <th>Status</th>
                <th>Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {confirmations.map(c => (
                <tr key={c.id}>
                  <td><span className="block-badge block-badge-blue uppercase text-xs">{c.confirmation_type}</span></td>
                  <td className="text-sm text-text-primary">{c.third_party_name}</td>
                  <td className="font-mono text-xs text-right">{formatCurrency(c.balance_per_books)}</td>
                  <td className="font-mono text-xs text-right">{formatCurrency(c.balance_confirmed)}</td>
                  <td className={`font-mono text-xs text-right ${c.discrepancy !== 0 ? 'text-accent-expense' : 'text-accent-income'}`}>
                    {formatCurrency(c.discrepancy)}
                  </td>
                  <td><span className={STATUS_BADGE[c.status] || 'block-badge'}>{c.status}</span></td>
                  <td className="text-xs text-text-muted whitespace-nowrap">{c.confirmation_date ? formatDate(c.confirmation_date) : '—'}</td>
                  <td>
                    <button className="block-btn block-btn-ghost text-xs py-0.5 px-2" onClick={() => openForm(c)}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ─── Inquiries Panel ──────────────────────────────────────
interface InquiriesPanelProps { companyId: string; }

const InquiriesPanel: React.FC<InquiriesPanelProps> = ({ companyId: _companyId }) => {
  const [inquiries, setInquiries] = useState<AuditorInquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [inquiriesKey, setInquiriesKey] = useState(0);
  const [showLogForm, setShowLogForm] = useState(false);
  const [respondingTo, setRespondingTo] = useState<AuditorInquiry | null>(null);

  // Log form
  const [firm, setFirm] = useState('');
  const [contact, setContact] = useState('');
  const [inquiryDate, setInquiryDate] = useState(new Date().toISOString().split('T')[0]);
  const [subject, setSubject] = useState('');
  const [inquiryText, setInquiryText] = useState('');
  const [logging, setLogging] = useState(false);
  const [logError, setLogError] = useState('');

  // Response form
  const [responseText, setResponseText] = useState('');
  const [responseBy, setResponseBy] = useState('');
  const [supportingDocs, setSupportingDocs] = useState('');
  const [responding, setResponding] = useState(false);
  const [respondError, setRespondError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.featAuditorInqList()
      .then((rows: AuditorInquiry[]) => { if (!cancelled) setInquiries(Array.isArray(rows) ? rows : []); })
      .catch((e: any) => { if (!cancelled) setError(e?.message || 'Failed to load inquiries'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [inquiriesKey]);

  const handleLog = async () => {
    if (!subject.trim()) { setLogError('Subject is required.'); return; }
    setLogging(true);
    try {
      const res = await api.featAuditorInqLog({
        auditor_firm: firm || null,
        auditor_contact: contact || null,
        inquiry_date: inquiryDate,
        inquiry_subject: subject.trim(),
        inquiry_text: inquiryText || null,
      });
      if (res?.error) throw new Error(res.error);
      setShowLogForm(false);
      setFirm(''); setContact(''); setSubject(''); setInquiryText('');
      setInquiriesKey(k => k + 1);
    } catch (e: any) {
      setLogError(e?.message || 'Log failed');
    } finally {
      setLogging(false);
    }
  };

  const handleRespond = async () => {
    if (!respondingTo) return;
    if (!responseText.trim()) { setRespondError('Response text is required.'); return; }
    setResponding(true);
    try {
      const res = await api.featAuditorInqRespond(respondingTo.id, responseText.trim(), responseBy || undefined, supportingDocs || undefined);
      if ((res as any)?.error) throw new Error((res as any).error);
      setRespondingTo(null);
      setResponseText(''); setResponseBy(''); setSupportingDocs('');
      setInquiriesKey(k => k + 1);
    } catch (e: any) {
      setRespondError(e?.message || 'Respond failed');
    } finally {
      setResponding(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-text-primary">Auditor Inquiry Log</p>
        <button className="block-btn block-btn-primary text-xs" onClick={() => setShowLogForm(v => !v)}>
          <Plus size={12} className="inline mr-1" />{showLogForm ? 'Cancel' : 'Log Inquiry'}
        </button>
      </div>

      {showLogForm && (
        <div className="block-card p-4 space-y-3">
          {logError && <ErrorBanner message={logError} onDismiss={() => setLogError('')} />}
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Log Auditor Inquiry</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">Auditor Firm</label>
              <input className="block-input" value={firm} onChange={e => setFirm(e.target.value)} placeholder="Firm name" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Contact</label>
              <input className="block-input" value={contact} onChange={e => setContact(e.target.value)} placeholder="Auditor name" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Inquiry Date</label>
              <input type="date" className="block-input" value={inquiryDate} onChange={e => setInquiryDate(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Subject *</label>
            <input className="block-input" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Inquiry subject" />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Inquiry Text</label>
            <textarea className="block-input min-h-[60px]" value={inquiryText} onChange={e => setInquiryText(e.target.value)} placeholder="Full inquiry or question..." />
          </div>
          <div className="flex gap-2 justify-end">
            <button className="block-btn block-btn-ghost" onClick={() => setShowLogForm(false)}>Cancel</button>
            <button className="block-btn block-btn-primary" onClick={handleLog} disabled={logging}>{logging ? 'Logging...' : 'Log Inquiry'}</button>
          </div>
        </div>
      )}

      {respondingTo && (
        <div className="block-card p-4 space-y-3 border-l-2 border-accent-primary">
          {respondError && <ErrorBanner message={respondError} onDismiss={() => setRespondError('')} />}
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Respond: {respondingTo.inquiry_subject}</p>
          <div>
            <label className="block text-xs text-text-muted mb-1">Response *</label>
            <textarea className="block-input min-h-[80px]" value={responseText} onChange={e => setResponseText(e.target.value)} placeholder="Your response..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">Responded By</label>
              <input className="block-input" value={responseBy} onChange={e => setResponseBy(e.target.value)} placeholder="Name" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Supporting Docs</label>
              <input className="block-input" value={supportingDocs} onChange={e => setSupportingDocs(e.target.value)} placeholder="Reference or path" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button className="block-btn block-btn-ghost" onClick={() => { setRespondingTo(null); setRespondError(''); }}>Cancel</button>
            <button className="block-btn block-btn-primary" onClick={handleRespond} disabled={responding}>{responding ? 'Submitting...' : 'Submit Response'}</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-text-muted">Loading inquiries...</p>
      ) : inquiries.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><MessageSquare size={22} className="text-text-muted" /></div>
          <p className="text-sm text-text-secondary font-medium">No inquiries logged</p>
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden">
          <table className="block-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Firm</th>
                <th>Subject</th>
                <th>Status</th>
                <th>Response Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {inquiries.map(inq => (
                <tr key={inq.id}>
                  <td className="font-mono text-xs whitespace-nowrap">{formatDate(inq.inquiry_date)}</td>
                  <td className="text-xs text-text-muted">{inq.auditor_firm || '—'}</td>
                  <td className="text-sm text-text-primary max-w-[200px] truncate" title={inq.inquiry_subject}>{inq.inquiry_subject}</td>
                  <td><span className={STATUS_BADGE[inq.status] || 'block-badge'}>{inq.status}</span></td>
                  <td className="text-xs text-text-muted whitespace-nowrap">{inq.response_date ? formatDate(inq.response_date) : '—'}</td>
                  <td>
                    {inq.status === 'open' && (
                      <button className="block-btn block-btn-ghost text-xs py-0.5 px-2" onClick={() => { setRespondingTo(inq); setResponseText(''); setResponseBy(''); setSupportingDocs(''); setRespondError(''); }}>Respond</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ─── Issues Panel ─────────────────────────────────────────
interface IssuesPanelProps { companyId: string; }

const IssuesPanel: React.FC<IssuesPanelProps> = ({ companyId: _companyId }) => {
  const [issues, setIssues] = useState<AuditIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [issuesKey, setIssuesKey] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<AuditIssue | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // Form
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [rootCause, setRootCause] = useState('');
  const [recommendation, setRecommendation] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Resolve form
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.featAuditIssueList()
      .then((rows: AuditIssue[]) => { if (!cancelled) setIssues(Array.isArray(rows) ? rows : []); })
      .catch((e: any) => { if (!cancelled) setError(e?.message || 'Failed to load issues'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [issuesKey]);

  const openForm = (issue?: AuditIssue) => {
    setEditTarget(issue || null);
    setTitle(issue?.title || '');
    setSeverity(issue?.severity || 'medium');
    setCategory(issue?.category || '');
    setDescription(issue?.description || '');
    setRootCause(issue?.root_cause || '');
    setRecommendation(issue?.recommendation || '');
    setAssignedTo(issue?.assigned_to || '');
    setTargetDate(issue?.target_resolution_date || '');
    setSaveError('');
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!title.trim()) { setSaveError('Title is required.'); return; }
    setSaving(true);
    try {
      const res = await api.featAuditIssueUpsert({
        id: editTarget?.id,
        title: title.trim(),
        severity,
        category: category || null,
        description: description || null,
        root_cause: rootCause || null,
        recommendation: recommendation || null,
        assigned_to: assignedTo || null,
        target_resolution_date: targetDate || null,
        status: editTarget?.status || 'open',
      });
      if (res?.error) throw new Error(res.error);
      setShowForm(false);
      setEditTarget(null);
      setIssuesKey(k => k + 1);
    } catch (e: any) {
      setSaveError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleResolve = async () => {
    if (!resolvingId) return;
    setResolving(true);
    try {
      const res = await api.featAuditIssueResolve(resolvingId, resolutionNotes);
      if ((res as any)?.error) throw new Error((res as any).error);
      setResolvingId(null);
      setResolutionNotes('');
      setIssuesKey(k => k + 1);
    } catch (e: any) {
      setResolveError(e?.message || 'Resolve failed');
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-text-primary">Audit Issues</p>
        <button className="block-btn block-btn-primary text-xs" onClick={() => openForm()}>
          <Plus size={12} className="inline mr-1" />New Issue
        </button>
      </div>

      {showForm && (
        <div className="block-card p-4 space-y-3">
          {saveError && <ErrorBanner message={saveError} onDismiss={() => setSaveError('')} />}
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">{editTarget ? 'Edit' : 'New'} Issue</p>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-text-muted mb-1">Title *</label>
              <input className="block-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Issue title" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Severity</label>
              <select className="block-select" value={severity} onChange={e => setSeverity(e.target.value)}>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">Category</label>
              <input className="block-input" value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. Controls, Disclosure" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Assigned To</label>
              <input className="block-input" value={assignedTo} onChange={e => setAssignedTo(e.target.value)} placeholder="Name" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Description</label>
            <textarea className="block-input" value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe the issue..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">Root Cause</label>
              <textarea className="block-input" value={rootCause} onChange={e => setRootCause(e.target.value)} placeholder="Root cause analysis..." />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Recommendation</label>
              <textarea className="block-input" value={recommendation} onChange={e => setRecommendation(e.target.value)} placeholder="Recommended remediation..." />
            </div>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Target Resolution Date</label>
            <input type="date" className="block-input" style={{ width: 'auto' }} value={targetDate} onChange={e => setTargetDate(e.target.value)} />
          </div>
          <div className="flex gap-2 justify-end">
            <button className="block-btn block-btn-ghost" onClick={() => { setShowForm(false); setEditTarget(null); }}>Cancel</button>
            <button className="block-btn block-btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save Issue'}</button>
          </div>
        </div>
      )}

      {resolvingId && (
        <div className="block-card p-4 space-y-3 border-l-2 border-accent-income">
          {resolveError && <ErrorBanner message={resolveError} onDismiss={() => setResolveError('')} />}
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Resolve Issue</p>
          <div>
            <label className="block text-xs text-text-muted mb-1">Resolution Notes</label>
            <textarea className="block-input min-h-[60px]" value={resolutionNotes} onChange={e => setResolutionNotes(e.target.value)} placeholder="Describe how the issue was resolved..." />
          </div>
          <div className="flex gap-2 justify-end">
            <button className="block-btn block-btn-ghost" onClick={() => { setResolvingId(null); setResolveError(''); }}>Cancel</button>
            <button className="block-btn block-btn-primary" onClick={handleResolve} disabled={resolving}>{resolving ? 'Resolving...' : 'Mark Resolved'}</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-text-muted">Loading issues...</p>
      ) : issues.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><AlertOctagon size={22} className="text-text-muted" /></div>
          <p className="text-sm text-text-secondary font-medium">No audit issues</p>
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden">
          <table className="block-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Title</th>
                <th>Severity</th>
                <th>Category</th>
                <th>Assigned To</th>
                <th>Target Date</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {issues.map(iss => (
                <tr key={iss.id}>
                  <td className="font-mono text-xs text-text-muted">{iss.issue_number}</td>
                  <td className="text-sm text-text-primary max-w-[180px] truncate" title={iss.title}>{iss.title}</td>
                  <td><span className={SEVERITY_BADGE[iss.severity] || 'block-badge'}>{iss.severity}</span></td>
                  <td className="text-xs text-text-muted">{iss.category || '—'}</td>
                  <td className="text-xs text-text-muted">{iss.assigned_to || '—'}</td>
                  <td className="text-xs text-text-muted whitespace-nowrap">{iss.target_resolution_date ? formatDate(iss.target_resolution_date) : '—'}</td>
                  <td><span className={STATUS_BADGE[iss.status] || 'block-badge'}>{iss.status}</span></td>
                  <td className="flex gap-1">
                    <button className="block-btn block-btn-ghost text-xs py-0.5 px-2" onClick={() => openForm(iss)}>Edit</button>
                    {iss.status !== 'resolved' && (
                      <button className="block-btn block-btn-ghost text-xs py-0.5 px-2" onClick={() => { setResolvingId(iss.id); setResolutionNotes(''); setResolveError(''); }}>Resolve</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ─── Main Component ────────────────────────────────────────
const AuditSampling: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [subTab, setSubTab] = useState<SubTab>('samples');

  if (!activeCompany) {
    return <div className="flex items-center justify-center h-64 text-text-muted text-sm">No active company.</div>;
  }

  const SUB_TABS: { id: SubTab; label: string; icon: React.ReactNode }[] = [
    { id: 'samples', label: 'Samples', icon: <FileSearch size={13} /> },
    { id: 'confirmations', label: 'Confirmations', icon: <CheckCircle size={13} /> },
    { id: 'inquiries', label: 'Inquiries', icon: <MessageSquare size={13} /> },
    { id: 'issues', label: 'Issues', icon: <AlertOctagon size={13} /> },
  ];

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      {/* Sub-tab bar */}
      <div className="flex gap-1 border-b border-border-primary pb-0">
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
              subTab === t.id
                ? 'border-accent-primary text-accent-primary font-medium'
                : 'border-transparent text-text-muted hover:text-text-secondary'
            }`}
            onClick={() => setSubTab(t.id)}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Panel */}
      {subTab === 'samples' && <SamplesPanel companyId={activeCompany.id} />}
      {subTab === 'confirmations' && <ConfirmationsPanel companyId={activeCompany.id} />}
      {subTab === 'inquiries' && <InquiriesPanel companyId={activeCompany.id} />}
      {subTab === 'issues' && <IssuesPanel companyId={activeCompany.id} />}
    </div>
  );
};

export default AuditSampling;
