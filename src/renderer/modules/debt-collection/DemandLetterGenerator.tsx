import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { FileText, Check, AlertTriangle } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate, formatStatus } from '../../lib/format';

// ─── Types ──────────────────────────────────────────────
interface DemandLetterGeneratorProps {
  debtId: string;
}

interface Template {
  id: string;
  name: string;
  severity: string;
  description: string;
  subject_template: string;
  body_template: string;
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

// ─── Merge field replacement ────────────────────────────
function mergeFields(
  text: string,
  debt: Debt,
  companyName: string
): string {
  return text
    .replace(/\{\{debtor_name\}\}/g, debt.debtor_name || '')
    .replace(/\{\{debtor_email\}\}/g, debt.debtor_email || '')
    .replace(/\{\{debtor_address\}\}/g, debt.debtor_address || '')
    .replace(/\{\{original_amount\}\}/g, formatCurrency(debt.original_amount))
    .replace(/\{\{balance_due\}\}/g, formatCurrency(debt.balance_due))
    .replace(/\{\{interest_accrued\}\}/g, formatCurrency(debt.interest_accrued))
    .replace(/\{\{fees_accrued\}\}/g, formatCurrency(debt.fees_accrued))
    .replace(/\{\{due_date\}\}/g, formatDate(debt.due_date))
    .replace(/\{\{delinquent_date\}\}/g, formatDate(debt.delinquent_date))
    .replace(/\{\{jurisdiction\}\}/g, debt.jurisdiction || '')
    .replace(/\{\{company_name\}\}/g, companyName)
    .replace(/\{\{current_date\}\}/g, formatDate(new Date().toISOString()));
}

// ─── Severity badge color ───────────────────────────────
const SEVERITY_STYLES: Record<string, string> = {
  low:      'bg-accent-blue/20 text-accent-blue',
  medium:   'bg-amber-500/20 text-amber-400',
  high:     'bg-accent-expense-bg0/20 text-red-400',
  critical: 'bg-red-700/20 text-red-300',
};

// ─── Component ──────────────────────────────────────────
const DemandLetterGenerator: React.FC<DemandLetterGeneratorProps> = ({ debtId }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [debt, setDebt] = useState<Debt | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [savingPdf, setSavingPdf] = useState(false);
  const [generatedHtml, setGeneratedHtml] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState('');

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
            'SELECT name FROM companies WHERE id = ?',
            [activeCompany.id]
          ),
        ]);
        if (cancelled) return;
        setTemplates(Array.isArray(tplData) ? tplData : []);
        setDebt(debtData || null);
        setCompanyName(
          Array.isArray(companyRows) && companyRows.length > 0
            ? companyRows[0].name
            : ''
        );
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
    return mergeFields(selectedTemplate.subject_template || '', debt, companyName);
  }, [selectedTemplate, debt, companyName]);

  const previewBody = useMemo(() => {
    if (!selectedTemplate || !debt) return '';
    return mergeFields(selectedTemplate.body_template || '', debt, companyName);
  }, [selectedTemplate, debt, companyName]);

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
        date_of_evidence: new Date().toISOString().slice(0, 10),
      });

      setSuccessMsg('Demand letter generated and logged successfully.');
    } catch (err) {
      console.error('Failed to generate demand letter:', err);
    } finally {
      setGenerating(false);
    }
  }, [debtId, selectedTemplate, previewSubject, previewBody, generating]);

  // ── Save as PDF ──
  const handleSavePdf = useCallback(async () => {
    if (!generatedHtml || savingPdf) return;
    setSavingPdf(true);
    try {
      await api.saveToPDF(generatedHtml, 'Demand Letter');
    } catch (err) {
      console.error('Failed to save PDF:', err);
    } finally {
      setSavingPdf(false);
    }
  }, [generatedHtml, savingPdf]);

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
      {/* Template Cards */}
      <div>
        <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
          Select Template
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {templates.map((tpl) => {
            const isActive = tpl.id === selectedTemplateId;
            const sevStyle = SEVERITY_STYLES[tpl.severity] || SEVERITY_STYLES.medium;
            return (
              <button
                key={tpl.id}
                onClick={() => {
                  setSelectedTemplateId(tpl.id);
                  setGeneratedHtml('');
                  setSuccessMsg('');
                }}
                className={`block-card text-left p-4 transition-colors cursor-pointer ${
                  isActive
                    ? 'ring-2 ring-accent-blue bg-bg-tertiary'
                    : 'hover:bg-bg-hover'
                }`}
                style={{ borderRadius: '6px' }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <FileText size={14} className="text-text-muted" />
                  <span className="text-sm font-bold text-text-primary truncate">
                    {tpl.name}
                  </span>
                </div>
                <span
                  className={`inline-block text-[10px] px-1.5 py-0.5 font-semibold uppercase ${sevStyle}`}
                  style={{ borderRadius: '6px' }}
                >
                  {tpl.severity}
                </span>
                {tpl.description && (
                  <p className="text-xs text-text-muted mt-2 line-clamp-2">
                    {tpl.description}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Preview Pane */}
      {selectedTemplate && debt && (
        <div className="block-card">
          <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
            Preview
          </h4>
          <div
            className="block-card bg-bg-primary p-4 font-mono text-sm text-text-secondary space-y-3"
            style={{ borderRadius: '6px' }}
          >
            <div>
              <span className="text-text-muted text-xs uppercase">Subject:</span>
              <p className="text-text-primary font-semibold">{previewSubject}</p>
            </div>
            <div className="border-t border-border-primary pt-3 whitespace-pre-wrap">
              {previewBody}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 mt-4">
            <button
              className="block-btn-primary flex items-center gap-2"
              onClick={handleGenerate}
              disabled={generating}
            >
              <FileText size={14} />
              {generating ? 'Generating...' : 'Generate & Log'}
            </button>
            {generatedHtml && (
              <button
                className="block-btn flex items-center gap-2"
                onClick={handleSavePdf}
                disabled={savingPdf}
              >
                {savingPdf ? 'Saving...' : 'Save as PDF'}
              </button>
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
