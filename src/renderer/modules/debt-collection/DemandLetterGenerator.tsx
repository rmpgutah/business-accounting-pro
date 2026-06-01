import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { FileText, Check, AlertTriangle, Eye, Printer, Mail, ClipboardCheck } from 'lucide-react';
import api from '../../lib/api';
import ErrorBanner from '../../components/ErrorBanner';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate, formatStatus } from '../../lib/format';
import { todayLocal } from '../../lib/date-helpers';

// ─── Types ──────────────────────────────────────────────
interface DemandLetterGeneratorProps {
  debtId: string;
}

interface Template {
  id: string;
  name: string;
  severity: string;
  subject: string;
  body: string;
}

interface Debt {
  id: string;
  debtor_name: string;
  debtor_email: string;
  debtor_address: string;
  original_amount: number;
  balance_due: number;
  interest_accrued: number;
  fees_accrued: number;
  due_date: string;
  delinquent_date: string;
  jurisdiction: string;
}

interface CompanyInfo {
  name: string;
  address?: string;
  phone?: string;
  email?: string;
}

// ─── Merge field replacement ────────────────────────────
function mergeFields(
  text: string,
  debt: Debt,
  companyInfo: CompanyInfo
): string {
  const companyName = companyInfo.name || '';
  const totalDue = (debt.balance_due || 0) + (debt.interest_accrued || 0) + (debt.fees_accrued || 0);
  const delinquent = debt.delinquent_date ? new Date(debt.delinquent_date) : null;
  const daysOverdue = delinquent && !isNaN(delinquent.getTime())
    ? Math.max(0, Math.floor((Date.now() - delinquent.getTime()) / 86400000))
    : 0;
  const demandDeadline = new Date(Date.now() + 14 * 86400000);
  const demandDeadlineIso = demandDeadline.toISOString().slice(0, 10);
  return text
    .replace(/\{\{debtor_name\}\}/g, debt.debtor_name || '')
    .replace(/\{\{debtor_email\}\}/g, debt.debtor_email || '')
    .replace(/\{\{debtor_address\}\}/g, debt.debtor_address || '')
    .replace(/\{\{original_amount\}\}/g, formatCurrency(debt.original_amount))
    .replace(/\{\{balance_due\}\}/g, formatCurrency(debt.balance_due))
    .replace(/\{\{interest_accrued\}\}/g, formatCurrency(debt.interest_accrued))
    .replace(/\{\{fees_accrued\}\}/g, formatCurrency(debt.fees_accrued))
    .replace(/\{\{total_due\}\}/g, formatCurrency(totalDue))
    .replace(/\{\{due_date\}\}/g, formatDate(debt.due_date))
    .replace(/\{\{delinquent_date\}\}/g, formatDate(debt.delinquent_date))
    .replace(/\{\{days_overdue\}\}/g, String(daysOverdue))
    .replace(/\{\{demand_deadline\}\}/g, formatDate(demandDeadlineIso))
    .replace(/\{\{jurisdiction\}\}/g, debt.jurisdiction || '')
    .replace(/\{\{company_name\}\}/g, companyName)
    .replace(/\{\{company_address\}\}/g, companyInfo.address || '')
    .replace(/\{\{company_phone\}\}/g, companyInfo.phone || '')
    .replace(/\{\{company_email\}\}/g, companyInfo.email || '')
    .replace(/\{\{current_date\}\}/g, formatDate(new Date().toISOString()));
}

// ─── Severity badge color ───────────────────────────────
// Mirrors the tone accents used in the PDF letterhead bar — keeps the
// UI and the resulting PDF visually consistent so the user always knows
// which severity they're about to send.
const SEVERITY_STYLES: Record<string, { badge: string; accent: string; icon: string }> = {
  low:      { badge: 'bg-blue-500/15 text-blue-400 border border-blue-500/30',     accent: 'var(--color-accent-blue)', icon: 'ℹ' },
  medium:   { badge: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',  accent: 'var(--color-accent-warning)', icon: '⚠' },
  high:     { badge: 'bg-red-500/15 text-red-400 border border-red-500/30',        accent: 'var(--color-accent-expense)', icon: '⚠' },
  critical: { badge: 'bg-red-700/20 text-red-300 border border-red-700/40',         accent: 'var(--color-accent-expense)', icon: '⛔' },
};

const TEMPLATE_TYPE_HINT: Record<string, string> = {
  reminder: 'Friendly first-touch reminder. Use within 1-30 days past due.',
  warning: 'Formal second notice. Use within 31-60 days past due.',
  final_notice: 'Last warning before legal action. Use 61-90 days past due.',
  demand: 'Formal legal demand for payment with 10-day deadline. Use 90+ days.',
  settlement_offer: 'Offer 70% balance settlement to close the account.',
  payment_confirmation: 'Confirm receipt of a payment and update the account.',
};

// ─── Component ──────────────────────────────────────────
const DemandLetterGenerator: React.FC<DemandLetterGeneratorProps> = ({ debtId }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [debt, setDebt] = useState<Debt | null>(null);
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo>({ name: '' });
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [savingPdf, setSavingPdf] = useState(false);
  const [generatedHtml, setGeneratedHtml] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // ── Load templates + debt ──
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      setLoading(true);
      setGeneratedHtml('');
      setSuccessMsg('');
      setSelectedTemplateId('');
      try {
        const [tplData, debtData, companyRows] = await Promise.all([
          api.query('debt_templates', { company_id: activeCompany.id }),
          api.get('debts', debtId),
          api.rawQuery(
            'SELECT name, address_line1, address_line2, city, state, zip, phone, email FROM companies WHERE id = ?',
            [activeCompany.id]
          ),
        ]);
        if (cancelled) return;
        setTemplates(Array.isArray(tplData) ? tplData : []);
        setDebt(debtData || null);
        if (Array.isArray(companyRows) && companyRows.length > 0) {
          const c = companyRows[0];
          const addr = [c.address_line1, c.address_line2, c.city, c.state, c.zip]
            .filter(Boolean)
            .join(', ');
          setCompanyInfo({
            name: c.name || '',
            address: addr,
            phone: c.phone || '',
            email: c.email || '',
          });
        } else {
          setCompanyInfo({ name: '' });
        }
      } catch (err) {
        console.error('Failed to load demand letter data:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeCompany, debtId]);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) || null,
    [templates, selectedTemplateId]
  );

  // ── Preview text ──
  const previewSubject = useMemo(() => {
    if (!selectedTemplate || !debt) return '';
    return mergeFields(selectedTemplate.subject || '', debt, companyInfo);
  }, [selectedTemplate, debt, companyInfo]);

  const previewBody = useMemo(() => {
    if (!selectedTemplate || !debt) return '';
    return mergeFields(selectedTemplate.body || '', debt, companyInfo);
  }, [selectedTemplate, debt, companyInfo]);

  // ── Generate & Log ──
  const handleGenerate = useCallback(async () => {
    if (!selectedTemplate || generating) return;
    setGenerating(true);
    setSuccessMsg('');
    try {
      const result = await api.debtGenerateDemandLetter(debtId, selectedTemplate.id);
      const html = result?.html || '';
      setGeneratedHtml(html);

      // Auto-create communication record
      await api.create('debt_communications', {
        debt_id: debtId,
        type: 'letter',
        direction: 'outbound',
        subject: previewSubject,
        body: previewBody,
        template_used: selectedTemplate.name,
      });

      // Auto-create evidence record
      await api.create('debt_evidence', {
        debt_id: debtId,
        type: 'communication',
        title: 'Demand Letter - ' + selectedTemplate.name,
        description: 'Auto-generated demand letter',
        court_relevance: 'high',
        date_of_evidence: todayLocal(),
      });

      setSuccessMsg('Demand letter generated and logged successfully.');
    } catch (err: any) {
      // VISIBILITY: surface generate-demand-letter errors instead of swallowing
      console.error('Failed to generate demand letter:', err);
      setErrorMsg(`Failed to generate demand letter: ${err?.message ?? String(err)}`);
    } finally {
      setGenerating(false);
    }
  }, [debtId, selectedTemplate, previewSubject, previewBody, generating]);

  // ── Save as PDF ──
  const handleSavePdf = useCallback(async () => {
    if (!generatedHtml || savingPdf) return;
    setSavingPdf(true);
    try {
      const filename = `${selectedTemplate?.name?.toLowerCase().replace(/\s+/g, '-') || 'demand'} — ${debt?.debtor_name || 'debt'}.pdf`;
      await api.saveToPDF(generatedHtml, filename);
    } catch (err: any) {
      console.error('Failed to save PDF:', err);
      setErrorMsg(`Failed to save PDF: ${err?.message ?? String(err)}`);
    } finally {
      setSavingPdf(false);
    }
  }, [generatedHtml, savingPdf, selectedTemplate, debt]);

  // ── Print directly (Blob URL avoids document.write XSS surface) ──
  const handlePrint = useCallback(() => {
    if (!generatedHtml) return;
    const blob = new Blob([generatedHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank', 'width=900,height=1100');
    if (!w) {
      URL.revokeObjectURL(url);
      setErrorMsg('Could not open print window — check popup blocker.');
      return;
    }
    // Wait for the new window to load before invoking print, then revoke URL.
    const tryPrint = () => {
      try { w.focus(); w.print(); } catch {}
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    };
    w.addEventListener('load', tryPrint, { once: true });
    // Fallback: if load event doesn't fire within 1.5s, print anyway.
    setTimeout(tryPrint, 1500);
  }, [generatedHtml]);

  // ── Copy plain-text body to clipboard (for pasting into email) ──
  const handleCopyText = useCallback(async () => {
    if (!previewBody) return;
    try {
      await navigator.clipboard.writeText(`Subject: ${previewSubject}\n\n${previewBody}`);
      setSuccessMsg('Letter copied to clipboard — paste into your email client.');
    } catch (err: any) {
      setErrorMsg('Could not copy to clipboard: ' + (err?.message || String(err)));
    }
  }, [previewBody, previewSubject]);

  // ── Email the debtor (opens default mail client with prefilled body) ──
  const handleEmail = useCallback(() => {
    if (!debt?.debtor_email) {
      setErrorMsg('Debtor has no email on file. Add one to send via email.');
      return;
    }
    const subject = encodeURIComponent(previewSubject);
    const body = encodeURIComponent(previewBody);
    window.location.href = `mailto:${debt.debtor_email}?subject=${subject}&body=${body}`;
  }, [debt, previewSubject, previewBody]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-text-muted text-sm">
        Loading templates...
      </div>
    );
  }

  // ── No templates ──
  if (templates.length === 0) {
    return (
      <div className="block-card text-center py-12">
        <AlertTriangle size={32} className="mx-auto text-amber-400 mb-3" />
        <p className="text-text-muted text-sm">
          No templates found. Go to Automation Settings to seed default templates.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {errorMsg && (
        <ErrorBanner
          message={errorMsg}
          title="Demand letter error"
          onDismiss={() => setErrorMsg('')}
        />
      )}
      {/* Template Cards — severity color-coded edge + hint text */}
      <div>
        <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
          Select Template
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {templates.map((tpl) => {
            const isActive = tpl.id === selectedTemplateId;
            const sev = SEVERITY_STYLES[tpl.severity] || SEVERITY_STYLES.medium;
            const hint = TEMPLATE_TYPE_HINT[tpl.id] || TEMPLATE_TYPE_HINT[tpl.name?.toLowerCase().replace(/\s+/g, '_')] || '';
            return (
              <button
                key={tpl.id}
                onClick={() => {
                  setSelectedTemplateId(tpl.id);
                  setGeneratedHtml('');
                  setSuccessMsg('');
                }}
                className={`block-card text-left p-4 transition-all cursor-pointer relative overflow-hidden ${
                  isActive
                    ? 'ring-2 ring-accent-blue bg-bg-tertiary'
                    : 'hover:bg-bg-hover hover:-translate-y-0.5'
                }`}
                style={{ borderRadius: '8px' }}
              >
                {/* Severity stripe — runs down the left edge */}
                <span
                  aria-hidden
                  style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0,
                    width: 3, background: sev.accent,
                  }}
                />
                <div className="flex items-start justify-between gap-2 mb-2 ml-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText size={14} className="text-text-muted shrink-0" />
                    <span className="text-sm font-bold text-text-primary truncate">
                      {tpl.name}
                    </span>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 font-bold uppercase tracking-wider shrink-0 ${sev.badge}`}
                    style={{ borderRadius: '4px' }}
                  >
                    <span aria-hidden>{sev.icon}</span>
                    {tpl.severity}
                  </span>
                </div>
                {hint && (
                  <p className="text-[11px] text-text-muted leading-snug ml-2 mt-1">{hint}</p>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Preview Pane — live iframe preview matches the PDF output exactly */}
      {selectedTemplate && debt && (
        <div className="block-card">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider flex items-center gap-2">
              <Eye size={12} />
              {generatedHtml ? 'Live Preview' : 'Text Preview'}
            </h4>
            {generatedHtml && (
              <span className="text-[10px] text-text-muted uppercase tracking-wider">
                What the recipient will see
              </span>
            )}
          </div>

          {/* When generated, show the actual rendered HTML (matches PDF) */}
          {generatedHtml ? (
            <iframe
              srcDoc={generatedHtml}
              title="Demand letter preview"
              sandbox="allow-same-origin"
              style={{
                width: '100%', height: 620, border: '1px solid var(--color-border-primary)',
                background: '#fff', borderRadius: 6,
              }}
            />
          ) : (
            <div
              className="block-card bg-bg-primary p-4 text-sm text-text-secondary space-y-3"
              style={{ borderRadius: '6px', maxHeight: 400, overflowY: 'auto' }}
            >
              <div>
                <span className="text-text-muted text-xs uppercase tracking-wider">Subject</span>
                <p className="text-text-primary font-semibold mt-1">{previewSubject}</p>
              </div>
              <div className="border-t border-border-primary pt-3 whitespace-pre-wrap font-serif leading-relaxed">
                {previewBody}
              </div>
              <div className="border-t border-border-primary pt-3 text-[11px] text-text-muted italic">
                Click "Generate &amp; Log" to render the full HTML letter with letterhead, accent bar, and remittance slip.
              </div>
            </div>
          )}

          {/* Action bar — primary + secondary actions grouped */}
          <div className="flex items-center gap-3 mt-4 flex-wrap">
            <button
              className="block-btn-primary flex items-center gap-2"
              onClick={handleGenerate}
              disabled={generating}
            >
              <FileText size={14} />
              {generating ? 'Generating…' : (generatedHtml ? 'Regenerate' : 'Generate & Log')}
            </button>
            {generatedHtml && (
              <>
                <button
                  className="block-btn flex items-center gap-2"
                  onClick={handlePrint}
                  title="Open in a new window and print"
                >
                  <Printer size={14} /> Print
                </button>
                <button
                  className="block-btn flex items-center gap-2"
                  onClick={handleSavePdf}
                  disabled={savingPdf}
                  title="Save the letter as a PDF file"
                >
                  <FileText size={14} />
                  {savingPdf ? 'Saving…' : 'Save PDF'}
                </button>
                <button
                  className="block-btn flex items-center gap-2"
                  onClick={handleEmail}
                  title={debt?.debtor_email ? `Email to ${debt.debtor_email}` : 'No debtor email on file'}
                  disabled={!debt?.debtor_email}
                >
                  <Mail size={14} /> Email
                </button>
                <button
                  className="block-btn flex items-center gap-2"
                  onClick={handleCopyText}
                  title="Copy subject + body to clipboard"
                >
                  <ClipboardCheck size={14} /> Copy Text
                </button>
              </>
            )}
          </div>

          {/* Success message */}
          {successMsg && (
            <div
              className="flex items-center gap-2 mt-3 px-3 py-2 bg-emerald-500/10 text-emerald-400 text-xs font-semibold"
              style={{ borderRadius: '6px' }}
            >
              <Check size={14} />
              {successMsg}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DemandLetterGenerator;
