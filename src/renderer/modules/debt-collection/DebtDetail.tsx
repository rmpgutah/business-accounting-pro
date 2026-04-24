import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  ArrowLeft,
  MessageSquare,
  DollarSign,
  ChevronRight,
  FileText,
  Pencil,
  XCircle,
  Mail,
  Phone,
  User,
  Scale,
  ArrowRight,
  RefreshCw,
  Pause,
  Play,
  Zap,
  Calendar,
  Receipt,
  Trash2,
  Plus,
} from 'lucide-react';
import api from '../../lib/api';
import PaymentPlanCard from './PaymentPlanCard';
import SettlementCard from './SettlementCard';
import ComplianceLog from './ComplianceLog';
import { formatCurrency, formatDate, formatStatus } from '../../lib/format';
import { useCompanyStore } from '../../stores/companyStore';
import { useNavigation } from '../../lib/navigation';
import { calcRiskScore, getRiskBadge } from './riskScore';
import RelatedPanel from '../../components/RelatedPanel';
import EntityTimeline from '../../components/EntityTimeline';

// ─── Types ──────────────────────────────────────────────
interface DebtDetailProps {
  debtId: string;
  onBack: () => void;
  onEdit: () => void;
  onRefresh: () => void;
  onOpenModal: (modal: 'communication' | 'payment' | 'evidence' | 'contact', editId?: string) => void;
  onInvoice: () => void;
}

interface Debt {
  id: string;
  type: string;
  status: string;
  debtor_name: string;
  debtor_type: string;
  debtor_email: string;
  debtor_phone: string;
  debtor_address: string;
  source_type: string;
  source_id: string;
  original_amount: number;
  interest_accrued: number;
  fees_accrued: number;
  payments_made: number;
  balance_due: number;
  interest_rate: number;
  interest_type: string;
  interest_start_date: string;
  compound_frequency: number;
  due_date: string;
  delinquent_date: string;
  statute_of_limitations_date: string;
  statute_years: number;
  jurisdiction: string;
  priority: string;
  current_stage: string;
  assigned_to: string;
  assigned_collector_id: string | null;
  auto_advance_enabled: number;
  hold: number;
  hold_reason: string;
  write_off_reason: string;
  preferred_contact_method: string;
  do_not_call: number;
  cease_desist_active: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

interface Payment {
  id: string;
  amount: number;
  method: string;
  reference_number: string;
  received_date: string;
  applied_to_principal: number;
  applied_to_interest: number;
  applied_to_fees: number;
  notes: string;
}

interface Communication {
  id: string;
  type: string;
  direction: string;
  subject: string;
  body: string;
  outcome: string;
  logged_at: string;
}

interface Evidence {
  id: string;
  type: string;
  title: string;
  description: string;
  date_of_evidence: string;
  court_relevance: string;
  created_at: string;
}

interface LegalAction {
  id: string;
  action_type: string;
  status: string;
  case_number: string;
  hearing_date: string;
  hearing_time: string;
  checklist_json: string;
  filing_date: string;
  court_name: string;
  created_at: string;
}

interface PipelineStage {
  id: string;
  stage: string;
  entered_at: string;
  exited_at: string | null;
  auto_advanced: number;
  advanced_by: string;
  notes: string;
}

interface InterestCalc {
  interest: number;
  total: number;
}

// ─── Priority Colors ────────────────────────────────────
const priorityDot: Record<string, string> = {
  low: 'bg-accent-income-bg',
  medium: 'bg-blue-500',
  high: 'bg-accent-warning-bg',
  critical: 'bg-accent-expense-bg',
};

// ─── Communication Icon Map ─────────────────────────────
const commIcon: Record<string, React.ReactNode> = {
  email: <Mail size={14} />,
  phone: <Phone size={14} />,
  letter: <FileText size={14} />,
  in_person: <User size={14} />,
  legal_filing: <Scale size={14} />,
  text: <MessageSquare size={14} />,
  fax: <FileText size={14} />,
};

// ─── Stage Colors ───────────────────────────────────────
const stageColor: Record<string, string> = {
  reminder: 'bg-blue-500',
  warning: 'bg-yellow-500',
  final_notice: 'bg-accent-warning-bg',
  demand_letter: 'bg-accent-expense-bg',
  collections_agency: 'bg-purple-500',
  legal_action: 'bg-red-600',
  judgment: 'bg-accent-income-bg',
  garnishment: 'bg-yellow-600',
};

// ─── Aging Badge ────────────────────────────────────────
const getAgingBadge = (delinquencyDate: string): { label: string; color: string; bg: string } => {
  if (!delinquencyDate) return { label: '—', color: 'var(--color-text-muted)', bg: 'transparent' };
  const days = Math.floor((Date.now() - new Date(delinquencyDate).getTime()) / 86400000);
  if (days <= 30)  return { label: `${days}d`, color: '#16a34a', bg: '#16a34a22' };
  if (days <= 90)  return { label: `${days}d`, color: '#d97706', bg: '#d9770622' };
  if (days <= 180) return { label: `${days}d`, color: '#ea580c', bg: '#ea580c22' };
  return { label: `${days}d`, color: '#dc2626', bg: '#dc262622' };
};

// ─── Helpers ────────────────────────────────────────────
function ageDays(dateStr: string): number {
  if (!dateStr) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000));
}

function daysUntil(dateStr: string): number {
  if (!dateStr) return 0;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

function truncate(text: string, max: number): string {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function parseChecklist(json: string): { total: number; done: number } {
  try {
    const items = JSON.parse(json || '[]');
    if (!Array.isArray(items)) return { total: 0, done: 0 };
    return {
      total: items.length,
      done: items.filter((i: any) => i.completed || i.done).length,
    };
  } catch {
    return { total: 0, done: 0 };
  }
}

function durationStr(entered: string, exited: string | null): string {
  const start = new Date(entered).getTime();
  const end = exited ? new Date(exited).getTime() : Date.now();
  const days = Math.floor((end - start) / 86400000);
  if (days < 1) return 'less than a day';
  if (days === 1) return '1 day';
  return `${days} days`;
}

// ─── Section Label ──────────────────────────────────────
const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider mb-4 pb-2 border-b border-border-primary">
    {children}
  </h3>
);

// ─── Info Row ───────────────────────────────────────────
const InfoRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-[10px] uppercase tracking-widest font-bold text-text-muted">{label}</span>
    <span className="text-sm text-text-primary">{children}</span>
  </div>
);

// ─── Component ──────────────────────────────────────────
const DebtDetail: React.FC<DebtDetailProps> = ({
  debtId,
  onBack,
  onEdit,
  onRefresh,
  onOpenModal,
  onInvoice,
}) => {
  // ── Store ──
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const nav = useNavigation();

  // ── State ──
  const [debt, setDebt] = useState<Debt | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [communications, setCommunications] = useState<Communication[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [legalActions, setLegalActions] = useState<LegalAction[]>([]);
  const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>([]);
  const [interestCalc, setInterestCalc] = useState<InterestCalc | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Write-off state
  const [showWriteOff, setShowWriteOff] = useState(false);
  const [writeOffReason, setWriteOffReason] = useState('');
  const [writeOffSaving, setWriteOffSaving] = useState(false);

  // Hold state
  const [holdReason, setHoldReason] = useState('');
  const [showHoldInput, setShowHoldInput] = useState(false);
  const [holdSaving, setHoldSaving] = useState(false);

  // Users for collector assignment
  const [users, setUsers] = useState<any[]>([]);

  // Advance stage
  const [advancingSaving, setAdvancingSaving] = useState(false);

  // Invoice link
  const [invoiceLink, setInvoiceLink] = useState<any>(null);

  // Activity timeline + quick note
  const [timeline, setTimeline] = useState<any[]>([]);
  const [quickNote, setQuickNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Promise-to-Pay state
  const [promises, setPromises] = useState<any[]>([]);
  const [showPromiseForm, setShowPromiseForm] = useState(false);
  const [promiseForm, setPromiseForm] = useState({ promised_date: '', promised_amount: 0, notes: '' });

  // Add Fee state
  const [showFeeForm, setShowFeeForm] = useState(false);
  const [feeForm, setFeeForm] = useState({ amount: '', feeType: 'late_fee', description: '' });
  const [feeSaving, setFeeSaving] = useState(false);

  // Disputes state
  const [disputes, setDisputes] = useState<any[]>([]);
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [disputeForm, setDisputeForm] = useState({ reason: 'other', description: '', status: 'open' });
  const [editingDisputeId, setEditingDisputeId] = useState<string | null>(null);
  const [disputeSaving, setDisputeSaving] = useState(false);

  // Letter dropdown
  const [showLetterMenu, setShowLetterMenu] = useState(false);

  // Installment calendar
  const [installments, setInstallments] = useState<any[]>([]);

  // Document attachments
  const [documents, setDocuments] = useState<any[]>([]);
  const [auditLog, setAuditLog] = useState<any[]>([]);

  // ── Load All Data ──
  useEffect(() => {
    let cancelled = false;
    const loadAll = async () => {
      try {
        const [
          debtData,
          paymentData,
          commData,
          evidenceData,
          legalData,
          stageData,
          interestData,
          promisesData,
          invoiceLinkData,
          timelineData,
          disputesData,
        ] = await Promise.all([
          api.get('debts', debtId),
          api.query('debt_payments', { debt_id: debtId }, { field: 'received_date', dir: 'desc' }),
          api.rawQuery(
            'SELECT * FROM debt_communications WHERE debt_id = ? ORDER BY logged_at DESC',
            [debtId]
          ),
          api.query('debt_evidence', { debt_id: debtId }),
          api.query('debt_legal_actions', { debt_id: debtId }),
          api.rawQuery(
            'SELECT * FROM debt_pipeline_stages WHERE debt_id = ? ORDER BY entered_at',
            [debtId]
          ),
          api.debtCalculateInterest(debtId).catch(() => null),
          api.listDebtPromises(debtId).catch(() => []),
          api.getDebtInvoiceLink(debtId).catch(() => null),
          api.getActivityTimeline(debtId).catch(() => []),
          api.query('debt_disputes', { debt_id: debtId }).catch(() => []),
        ]);
        api.listUsers().then(setUsers).catch(() => {});
        if (cancelled) return;
        setDebt(debtData ?? null);
        setPayments(Array.isArray(paymentData) ? paymentData : []);
        setCommunications(Array.isArray(commData) ? commData : []);
        setEvidence(Array.isArray(evidenceData) ? evidenceData : []);
        setLegalActions(Array.isArray(legalData) ? legalData : []);
        setPipelineStages(Array.isArray(stageData) ? stageData : []);
        setInterestCalc(interestData);
        setPromises(Array.isArray(promisesData) ? promisesData : []);
        setDisputes(Array.isArray(disputesData) ? disputesData : []);
        setInvoiceLink(invoiceLinkData ?? null);
        setTimeline(Array.isArray(timelineData) ? timelineData : []);
        // Load installments + documents in parallel (non-blocking)
        api.upcomingInstallments(debtId).then(r => setInstallments(Array.isArray(r) ? r : [])).catch(() => {});
        api.rawQuery('SELECT * FROM documents WHERE entity_type = ? AND entity_id = ? ORDER BY uploaded_at DESC', ['debt', debtId]).then(r => setDocuments(Array.isArray(r) ? r : [])).catch(() => {});
        api.debtAuditLog(debtId, 100).then(r => setAuditLog(Array.isArray(r) ? r : [])).catch(() => {});
      } catch (err) {
        console.error('Failed to load debt detail:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadAll();
    return () => {
      cancelled = true;
    };
  }, [debtId, refreshKey]);

  // ── Refresh helper ──
  const triggerRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    onRefresh();
  }, [onRefresh]);

  const handleDeleteComm = async (id: string) => {
    if (!window.confirm('Delete this communication?')) return;
    try {
      await api.remove('debt_communications', id);
      triggerRefresh();
    } catch (err: any) {
      console.error('Failed to delete communication:', err);
      alert('Operation failed: ' + (err?.message || 'Unknown error'));
    }
  };

  const handleDeleteEvidence = async (id: string) => {
    if (!window.confirm('Delete this evidence item?')) return;
    try {
      await api.remove('debt_evidence', id);
      triggerRefresh();
    } catch (err: any) {
      console.error('Failed to delete evidence:', err);
      alert('Operation failed: ' + (err?.message || 'Unknown error'));
    }
  };

  const handleDeleteLegalAction = async (id: string) => {
    if (!window.confirm('Delete this legal action?')) return;
    try {
      await api.remove('debt_legal_actions', id);
      triggerRefresh();
    } catch (err: any) {
      console.error('Failed to delete legal action:', err);
      alert('Operation failed: ' + (err?.message || 'Unknown error'));
    }
  };

  const handleDeletePayment = async (id: string) => {
    if (!window.confirm('Delete this payment record?')) return;
    try {
      await api.remove('debt_payments', id);
      triggerRefresh();
    } catch (err: any) {
      console.error('Failed to delete payment:', err);
      alert('Operation failed: ' + (err?.message || 'Unknown error'));
    }
  };

  const handleDeletePromise = async (id: string) => {
    if (!window.confirm('Delete this promise-to-pay?')) return;
    try {
      await api.remove('debt_promises', id);
      triggerRefresh();
    } catch (err: any) {
      console.error('Failed to delete promise:', err);
      alert('Operation failed: ' + (err?.message || 'Unknown error'));
    }
  };

  // ── Add Fee ──
  const handleSaveFee = async () => {
    const amt = parseFloat(feeForm.amount);
    if (!amt || amt <= 0) return;
    setFeeSaving(true);
    try {
      await api.addDebtFee(debtId, amt, feeForm.feeType, feeForm.description);
      setShowFeeForm(false);
      setFeeForm({ amount: '', feeType: 'late_fee', description: '' });
      triggerRefresh();
    } catch (err: any) {
      console.error('Failed to add fee:', err);
      alert('Operation failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setFeeSaving(false);
    }
  };

  // ── Disputes ──
  const handleSaveDispute = async () => {
    if (disputeSaving) return;
    setDisputeSaving(true);
    try {
      const payload = {
        debt_id: debtId,
        reason: disputeForm.reason,
        description: disputeForm.description,
        status: disputeForm.status,
      };
      if (editingDisputeId) {
        await api.update('debt_disputes', editingDisputeId, payload);
      } else {
        await api.create('debt_disputes', payload);
        // Auto-set debt status to disputed
        await api.update('debts', debtId, { status: 'disputed' });
      }
      setShowDisputeForm(false);
      setEditingDisputeId(null);
      setDisputeForm({ reason: 'other', description: '', status: 'open' });
      triggerRefresh();
    } catch (err: any) {
      console.error('Failed to save dispute:', err);
      alert('Operation failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setDisputeSaving(false);
    }
  };

  const handleEditDispute = (d: any) => {
    setEditingDisputeId(d.id);
    setDisputeForm({ reason: d.reason, description: d.description || '', status: d.status });
    setShowDisputeForm(true);
  };

  const handleDeleteDispute = async (id: string) => {
    if (!window.confirm('Delete this dispute?')) return;
    try {
      await api.remove('debt_disputes', id);
      triggerRefresh();
    } catch (err: any) {
      console.error('Failed to delete dispute:', err);
      alert('Operation failed: ' + (err?.message || 'Unknown error'));
    }
  };

  // ── Document Upload ──
  const handleUploadDocument = async () => {
    try {
      const result = await api.openFileDialog();
      if (result && !result.canceled && result.filePaths?.length > 0) {
        const fullPath = result.filePaths[0];
        const fileName = fullPath.split(/[\\/]/).pop() || fullPath;
        await api.uploadDebtDocument(debtId, fullPath, fileName, 0);
        triggerRefresh();
      }
    } catch (err: any) {
      console.error('Failed to upload document:', err);
      alert('Operation failed: ' + (err?.message || 'Unknown error'));
    }
  };

  const handleDeleteDocument = async (id: string) => {
    if (!window.confirm('Delete this document?')) return;
    try {
      await api.remove('documents', id);
      triggerRefresh();
    } catch (err: any) {
      console.error('Failed to delete document:', err);
      alert('Operation failed: ' + (err?.message || 'Unknown error'));
    }
  };

  // ── Letter Generation ──
  const handleGenerateLetter = async (type: string) => {
    setShowLetterMenu(false);
    if (!debt) return;
    try {
      const { generateCollectionLetterHTML } = await import('../../lib/print-templates');
      const html = generateCollectionLetterHTML(debt, payments, activeCompany, type);
      await api.printPreview(html, `${type.replace(/_/g, ' ')} — ${debt.debtor_name}`);
    } catch (err: any) {
      console.error('Failed to generate letter:', err);
      alert('Operation failed: ' + (err?.message || 'Unknown error'));
    }
  };

  // ── Recalculate Interest ──
  const handleRecalcInterest = useCallback(async () => {
    try {
      const result = await api.debtCalculateInterest(debtId);
      setInterestCalc(result);
    } catch (err: any) {
      console.error('Failed to recalculate interest:', err);
      alert('Operation failed: ' + (err?.message || 'Unknown error'));
    }
  }, [debtId]);

  // ── Advance Stage ──
  const handleAdvanceStage = useCallback(async () => {
    setAdvancingSaving(true);
    try {
      await api.debtAdvanceStage(debtId);
      triggerRefresh();
    } catch (err: any) {
      console.error('Failed to advance stage:', err);
      alert('Operation failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setAdvancingSaving(false);
    }
  }, [debtId, triggerRefresh]);

  // ── Hold Toggle ──
  const handleHoldToggle = useCallback(async () => {
    if (!debt) return;
    if (debt.hold) {
      // Release hold
      setHoldSaving(true);
      try {
        await api.debtHoldToggle(debtId, false);
        triggerRefresh();
      } catch (err: any) {
        console.error('Failed to release hold:', err);
        alert('Operation failed: ' + (err?.message || 'Unknown error'));
      } finally {
        setHoldSaving(false);
      }
    } else {
      // Show input for hold reason
      setShowHoldInput(true);
    }
  }, [debt, debtId, triggerRefresh]);

  const handleHoldConfirm = useCallback(async () => {
    setHoldSaving(true);
    try {
      await api.debtHoldToggle(debtId, true, holdReason);
      setShowHoldInput(false);
      setHoldReason('');
      triggerRefresh();
    } catch (err: any) {
      console.error('Failed to put on hold:', err);
      alert('Operation failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setHoldSaving(false);
    }
  }, [debtId, holdReason, triggerRefresh]);

  // ── Write Off ──
  const handleWriteOff = useCallback(async () => {
    if (!writeOffReason.trim()) return;
    setWriteOffSaving(true);
    try {
      await api.update('debts', debtId, {
        status: 'written_off',
        write_off_reason: writeOffReason.trim(),
      });
      setShowWriteOff(false);
      setWriteOffReason('');
      triggerRefresh();
    } catch (err: any) {
      console.error('Failed to write off debt:', err);
      alert('Operation failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setWriteOffSaving(false);
    }
  }, [debtId, writeOffReason, triggerRefresh]);

  // ── Save Promise ──
  const savePromise = async () => {
    if (!promiseForm.promised_date || !promiseForm.promised_amount) return;
    await api.saveDebtPromise({
      debt_id: debtId,
      promised_date: promiseForm.promised_date,
      promised_amount: promiseForm.promised_amount,
      kept: false,
      notes: promiseForm.notes,
    });
    setPromiseForm({ promised_date: '', promised_amount: 0, notes: '' });
    setShowPromiseForm(false);
    const updated = await api.listDebtPromises(debtId);
    setPromises(updated || []);
  };

  // ── Toggle Promise Kept ──
  const togglePromiseKept = async (id: string, currentKept: boolean) => {
    await api.updateDebtPromise(id, !currentKept);
    const updated = await api.listDebtPromises(debtId);
    setPromises(updated || []);
  };

  // ── Computed ──
  const delinquentDays = useMemo(
    () => (debt?.delinquent_date ? ageDays(debt.delinquent_date) : 0),
    [debt]
  );

  const interestFormula = useMemo(() => {
    if (!debt) return '';
    if (debt.interest_type === 'compound') {
      return 'Compound: P x (1 + r/n)^(nt) - P';
    }
    return 'Simple: P x r x t';
  }, [debt]);

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading debt details...
      </div>
    );
  }

  if (!debt) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-text-muted text-sm">Debt not found</p>
        <button className="block-btn flex items-center gap-2" onClick={onBack}>
          <ArrowLeft size={16} />
          Back
        </button>
      </div>
    );
  }

  const stageBadge = formatStatus(debt.current_stage);
  const statusBadge = formatStatus(debt.status);
  const sourceLabel =
    debt.source_type === 'invoice'
      ? `Invoice ${(debt.source_id || '').substring(0, 8)}`
      : debt.source_type === 'bill'
        ? `Bill ${(debt.source_id || '').substring(0, 8)}`
        : 'Manual entry';

  return (
    <div className="space-y-4">
      {/* ── Header Bar ── */}
      <div className="block-card p-4">
        {/* Top row: back + name + balance + stage + priority */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <button className="block-btn flex items-center gap-2 px-3 py-2" onClick={onBack}>
              <ArrowLeft size={16} />
              Back
            </button>
            <h2 className="text-xl font-bold text-text-primary">{debt.debtor_name}</h2>
            <div
              className={`w-2.5 h-2.5 ${priorityDot[debt.priority] || 'bg-bg-secondary'}`}
              style={{ borderRadius: '6px' }}
              title={`Priority: ${debt.priority ? debt.priority.charAt(0).toUpperCase() + debt.priority.slice(1) : ''}`}
            />
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xl font-bold text-text-primary font-mono">
              {formatCurrency(debt.balance_due)}
            </span>
            {(() => {
              const badge = getAgingBadge(debt.delinquent_date);
              return (
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                  background: badge.bg, color: badge.color,
                  letterSpacing: '0.5px', textTransform: 'uppercase'
                }}>
                  {badge.label}
                </span>
              );
            })()}
            {(() => {
              const brokenCount = promises.filter(
                p => p.kept === 0 && p.promised_date < new Date().toISOString().slice(0, 10)
              ).length;
              const score = calcRiskScore(debt, brokenCount);
              const risk = getRiskBadge(score);
              return (
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                  background: risk.color + '20', color: risk.color,
                }}>
                  Risk: {risk.label} ({score})
                </span>
              );
            })()}
            <span className={stageBadge.className}>{stageBadge.label}</span>
            <span className={statusBadge.className}>{statusBadge.label}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="text-text-muted" style={{ fontSize: 12 }}>Collector:</span>
              <select
                className="block-select"
                style={{ fontSize: 12, padding: '2px 8px', minWidth: 140 }}
                value={debt.assigned_collector_id || ''}
                onChange={async (e) => {
                  try {
                    await api.assignCollector(debt.id, e.target.value || null);
                    onRefresh();
                  } catch (err: any) {
                    console.error('Failed to assign collector:', err);
                    alert('Operation failed: ' + (err?.message || 'Unknown error'));
                  }
                }}
              >
                <option value="">Unassigned</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.display_name || u.email}</option>
                ))}
              </select>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!debt.auto_advance_enabled}
                onChange={async e => {
                  try {
                    await api.update('debts', debt.id, { auto_advance_enabled: e.target.checked ? 1 : 0 });
                    triggerRefresh();
                  } catch (err: any) {
                    console.error('Failed to update auto-advance:', err);
                    alert('Operation failed: ' + (err?.message || 'Unknown error'));
                  }
                }}
                style={{ width: 14, height: 14 }}
              />
              Auto-advance stage
            </label>
          </div>
        </div>

        {/* Hold banner */}
        {debt.hold ? (
          <div
            className="flex items-center justify-between mt-3 px-4 py-2 border border-yellow-600"
            style={{ borderRadius: '6px', background: 'rgba(234, 179, 8, 0.1)' }}
          >
            <div className="flex items-center gap-2 text-yellow-500 text-sm">
              <Pause size={14} />
              <span className="font-semibold">ON HOLD</span>
              {debt.hold_reason && (
                <span className="text-text-muted ml-1">
                  {debt.hold_reason}
                </span>
              )}
            </div>
            <button
              className="block-btn text-xs flex items-center gap-1"
              onClick={handleHoldToggle}
              disabled={holdSaving}
            >
              <Play size={12} />
              {holdSaving ? 'Releasing...' : 'Release Hold'}
            </button>
          </div>
        ) : showHoldInput ? (
          <div
            className="flex items-center gap-3 mt-3 px-4 py-2 border border-border-primary"
            style={{ borderRadius: '6px', background: 'rgba(18,20,28,0.80)' }}
          >
            <span className="text-xs text-text-secondary font-semibold whitespace-nowrap">Hold reason:</span>
            <input
              type="text"
              className="block-input flex-1"
              placeholder="Reason for holding..."
              value={holdReason}
              onChange={(e) => setHoldReason(e.target.value)}
            />
            <button
              className="block-btn-primary text-xs"
              onClick={handleHoldConfirm}
              disabled={holdSaving}
            >
              {holdSaving ? 'Saving...' : 'Confirm Hold'}
            </button>
            <button className="block-btn text-xs" onClick={() => setShowHoldInput(false)}>
              Cancel
            </button>
          </div>
        ) : null}

        {/* Action buttons */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <button
            className="block-btn flex items-center gap-2 text-xs"
            onClick={() => onOpenModal('communication')}
          >
            <MessageSquare size={14} />
            Log Communication
          </button>
          <button
            className="block-btn flex items-center gap-2 text-xs"
            onClick={() => onOpenModal('payment')}
          >
            <DollarSign size={14} />
            Record Payment
          </button>
          <button
            className="block-btn flex items-center gap-2 text-xs"
            onClick={handleAdvanceStage}
            disabled={advancingSaving}
          >
            <ChevronRight size={14} />
            {advancingSaving ? 'Advancing...' : 'Advance Stage'}
          </button>
          <button
            className="block-btn flex items-center gap-2 text-xs"
            onClick={() => setShowFeeForm(v => !v)}
          >
            <DollarSign size={14} />
            Add Fee
          </button>
          <button
            className="block-btn flex items-center gap-2 text-xs"
            onClick={() => onOpenModal('evidence')}
          >
            <FileText size={14} />
            Add Evidence
          </button>
          {!debt.hold && (
            <button
              className="block-btn flex items-center gap-2 text-xs"
              onClick={handleHoldToggle}
            >
              <Pause size={14} />
              Put on Hold
            </button>
          )}
          <button
            className="block-btn flex items-center gap-2 text-xs"
            onClick={onEdit}
          >
            <Pencil size={14} />
            Edit
          </button>
          <button
            className="block-btn flex items-center gap-2 text-xs text-accent-expense hover:bg-accent-expense/10 transition-colors"
            onClick={async () => {
              if (!window.confirm(`Delete this debt for "${debt?.debtor_name}"? All related records will be removed.`)) return;
              try {
                await api.remove('debts', debtId);
                onBack();
              } catch (err: any) {
                console.error('Failed to delete debt:', err);
                alert('Operation failed: ' + (err?.message || 'Unknown error'));
              }
            }}
          >
            <Trash2 size={14} />
            Delete
          </button>
          <button
            className="block-btn flex items-center gap-2 text-xs"
            onClick={onInvoice}
            title="Generate Statement of Account"
          >
            <Receipt size={14} />
            Statement
          </button>
          <div className="relative">
            <button
              className="block-btn flex items-center gap-1.5 text-xs"
              onClick={() => setShowLetterMenu(v => !v)}
            >
              <FileText size={13} />
              Generate Letter
              <ChevronRight size={10} className={`transition-transform ${showLetterMenu ? 'rotate-90' : ''}`} />
            </button>
            {showLetterMenu && (
              <div className="absolute top-full left-0 mt-1 z-30 block-card-elevated p-1 min-w-[180px] space-y-0.5" style={{ borderRadius: '6px' }}>
                {[
                  { key: 'reminder', label: 'Reminder Letter' },
                  { key: 'warning', label: 'Warning Notice' },
                  { key: 'final_notice', label: 'Final Notice' },
                  { key: 'demand', label: 'Demand Letter' },
                  { key: 'settlement_offer', label: 'Settlement Offer' },
                  { key: 'payment_confirmation', label: 'Payment Confirmation' },
                ].map(lt => (
                  <button
                    key={lt.key}
                    className="w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors"
                    style={{ borderRadius: '6px' }}
                    onClick={() => handleGenerateLetter(lt.key)}
                  >
                    {lt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="block-btn flex items-center gap-2 text-xs"
            onClick={async () => {
              const data = await api.generateCourtPacket(debtId);
              if (data?.error) { console.error(data.error); return; }
              const { generateCourtPacketHTML } = await import('../../lib/print-templates');
              const html = generateCourtPacketHTML(data);
              await api.printPreview(html, `Court Packet — ${debt?.debtor_name}`);
            }}
          >
            <Scale size={14} />
            Court Packet
          </button>
          <button
            className="block-btn flex items-center gap-2 text-xs"
            onClick={async () => {
              const { generateVerificationAffidavitHTML } = await import('../../lib/print-templates');
              const html = generateVerificationAffidavitHTML(debt, activeCompany, activeCompany?.name || '');
              await api.printPreview(html, `Verification Affidavit — ${debt?.debtor_name}`);
            }}
          >
            <FileText size={14} />
            Affidavit
          </button>
          <button
            className="block-btn flex items-center gap-2 text-xs text-red-400"
            onClick={() => setShowWriteOff(true)}
          >
            <XCircle size={14} />
            Write Off
          </button>
        </div>

        {/* Cease & Desist / DNC Banner */}
        {(!!debt.cease_desist_active || !!debt.do_not_call) && (
          <div className="mt-3 flex items-center gap-3 px-4 py-2.5 border border-red-700/50" style={{ borderRadius: '6px', background: 'rgba(248,113,113,0.08)' }}>
            {!!debt.cease_desist_active && (
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: '#dc262622', color: '#f87171', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Cease & Desist Active
              </span>
            )}
            {!!debt.do_not_call && (
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: '#d9770622', color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Do Not Call
              </span>
            )}
            {debt.preferred_contact_method && (
              <span className="text-xs text-text-secondary">
                Preferred: <strong className="capitalize">{debt.preferred_contact_method}</strong>
              </span>
            )}
            <span className="text-xs text-red-400 ml-auto">Outbound contact restricted</span>
          </div>
        )}

        {/* Contact Preference Badges (non-restricted) */}
        {!debt.cease_desist_active && !debt.do_not_call && debt.preferred_contact_method && (
          <div className="mt-2 flex items-center gap-2">
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: '#2563eb22', color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {debt.preferred_contact_method} preferred
            </span>
          </div>
        )}

        {/* Add Fee Form */}
        {showFeeForm && (
          <div className="mt-3 p-4 border border-border-primary" style={{ borderRadius: '6px', background: 'rgba(18,20,28,0.90)' }}>
            <p className="text-sm font-semibold text-text-primary mb-3">Add Fee</p>
            <div className="grid grid-cols-4 gap-3 items-end">
              <div>
                <label className="block text-xs text-text-muted mb-1">Amount</label>
                <input type="number" step="0.01" min="0" className="block-input" placeholder="0.00" value={feeForm.amount} onChange={(e) => setFeeForm(f => ({ ...f, amount: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Fee Type</label>
                <select className="block-select" value={feeForm.feeType} onChange={(e) => setFeeForm(f => ({ ...f, feeType: e.target.value }))}>
                  <option value="late_fee">Late Fee</option>
                  <option value="collection_fee">Collection Fee</option>
                  <option value="admin_fee">Admin Fee</option>
                  <option value="court_cost">Court Cost</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Description</label>
                <input className="block-input" placeholder="Optional description" value={feeForm.description} onChange={(e) => setFeeForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="flex gap-2">
                <button className="block-btn-primary text-xs py-2 px-4" onClick={handleSaveFee} disabled={feeSaving}>
                  {feeSaving ? 'Adding...' : 'Add Fee'}
                </button>
                <button className="block-btn text-xs py-2 px-3" onClick={() => setShowFeeForm(false)}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* Write Off Confirmation */}
        {showWriteOff && (
          <div
            className="mt-3 p-4 border border-red-700"
            style={{ borderRadius: '6px', background: 'rgba(248,113,113,0.08)' }}
          >
            <p className="text-sm text-red-400 font-semibold mb-2">Write Off Debt</p>
            <textarea
              className="block-input w-full mb-2"
              rows={3}
              placeholder="Reason for writing off this debt (required)..."
              value={writeOffReason}
              onChange={(e) => setWriteOffReason(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <button
                className="block-btn-danger flex items-center gap-2 text-xs"
                onClick={handleWriteOff}
                disabled={writeOffSaving || !writeOffReason.trim()}
              >
                <XCircle size={14} />
                {writeOffSaving ? 'Writing Off...' : 'Confirm Write Off'}
              </button>
              <button
                className="block-btn text-xs"
                onClick={() => {
                  setShowWriteOff(false);
                  setWriteOffReason('');
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Two Column Layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* ── Left Column (3/5 = 60%) ── */}
        <div className="lg:col-span-3 space-y-4">
          {/* Card 1 — Debt Information */}
          <div className="block-card p-6">
            <SectionLabel>Debt Information</SectionLabel>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <InfoRow label="Type"><span className="capitalize">{debt.type}</span></InfoRow>
              <InfoRow label="Status">
                <span className={statusBadge.className}>{statusBadge.label}</span>
              </InfoRow>
              <InfoRow label="Source">
                {debt.source_type === 'invoice' && debt.source_id ? (
                  <span
                    className="text-accent-blue cursor-pointer hover:underline"
                    onClick={() => nav.goToInvoice(debt.source_id)}
                    title="View original invoice"
                  >
                    {sourceLabel}
                  </span>
                ) : debt.source_type !== 'manual' ? (
                  <span className="text-accent-blue">{sourceLabel}</span>
                ) : (
                  sourceLabel
                )}
                {invoiceLink && (
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                    Linked invoice
                  </div>
                )}
              </InfoRow>
              <InfoRow label="Debtor Type">{debt.debtor_type}</InfoRow>
              <InfoRow label="Original Amount">
                <span className="font-mono">{formatCurrency(debt.original_amount)}</span>
              </InfoRow>
              <InfoRow label="Interest Accrued">
                <span className="font-mono">{formatCurrency(debt.interest_accrued)}</span>
              </InfoRow>
              <InfoRow label="Fees">
                <span className="font-mono">{formatCurrency(debt.fees_accrued)}</span>
              </InfoRow>
              <InfoRow label="Payments Made">
                <span className="font-mono">{formatCurrency(debt.payments_made)}</span>
              </InfoRow>
              <InfoRow label="Balance Due">
                <span className="font-mono font-bold text-red-400">
                  {formatCurrency(debt.balance_due)}
                </span>
              </InfoRow>
              <InfoRow label="Interest Rate">
                {debt.interest_rate
                  ? `${(debt.interest_rate * 100).toFixed(2)}% (${debt.interest_type})`
                  : 'None'}
              </InfoRow>
              <InfoRow label="Due Date">{formatDate(debt.due_date)}</InfoRow>
              <InfoRow label="Delinquent Date">{formatDate(debt.delinquent_date)}</InfoRow>
              <InfoRow label="Age in Days">
                <span className="font-mono">{delinquentDays} days</span>
              </InfoRow>
              <InfoRow label="Jurisdiction">{debt.jurisdiction || '--'}</InfoRow>
              <InfoRow label="Statute of Limitations">
                {debt.statute_of_limitations_date
                  ? formatDate(debt.statute_of_limitations_date)
                  : '--'}
              </InfoRow>
              <InfoRow label="Assigned To">{debt.assigned_to || '--'}</InfoRow>
            </div>
          </div>

          {/* Card 2 — Interest Calculator */}
          <div className="block-card p-6">
            <SectionLabel>Interest Calculator</SectionLabel>
            <div className="grid grid-cols-2 gap-4 mb-3">
              <InfoRow label="Accrued Interest">
                <span className="font-mono text-lg font-bold">
                  {interestCalc ? formatCurrency(interestCalc.interest) : '--'}
                </span>
              </InfoRow>
              <InfoRow label="Total with Interest">
                <span className="font-mono text-lg font-bold">
                  {interestCalc ? formatCurrency(interestCalc.total) : '--'}
                </span>
              </InfoRow>
              <InfoRow label="Formula">
                <span className="font-mono text-xs text-text-muted">{interestFormula}</span>
              </InfoRow>
              <InfoRow label="Rate">
                {debt.interest_rate
                  ? `${(debt.interest_rate * 100).toFixed(2)}%`
                  : 'None'}
              </InfoRow>
              <InfoRow label="Start Date">
                {formatDate(debt.interest_start_date)}
              </InfoRow>
              <InfoRow label="Days Elapsed">
                <span className="font-mono">
                  {debt.interest_start_date ? ageDays(debt.interest_start_date) : 0}
                </span>
              </InfoRow>
            </div>
            <button
              className="block-btn flex items-center gap-2 text-xs"
              onClick={handleRecalcInterest}
            >
              <RefreshCw size={14} />
              Recalculate
            </button>
          </div>

          {/* Card 3 — Payment History */}
          <div className="block-card p-0 overflow-hidden">
            <div className="p-6 pb-0">
              <SectionLabel>Payment History</SectionLabel>
            </div>
            {payments.length === 0 ? (
              <div className="px-6 pb-6 text-sm text-text-muted">No payments recorded</div>
            ) : (
              <table className="block-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="text-right">Amount</th>
                    <th>Method</th>
                    <th>Reference</th>
                    <th>Allocation</th>
                    <th>Notes</th>
                    <th style={{ width: 60 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td className="font-mono text-xs">{formatDate(p.received_date)}</td>
                      <td className="text-right font-mono font-bold text-green-400">
                        {formatCurrency(p.amount)}
                      </td>
                      <td className="text-xs capitalize">{p.method || '--'}</td>
                      <td className="text-xs font-mono text-text-muted">
                        {p.reference_number || '--'}
                      </td>
                      <td className="text-xs text-text-secondary">
                        {formatCurrency(p.applied_to_principal)} principal /{' '}
                        {formatCurrency(p.applied_to_interest)} interest /{' '}
                        {formatCurrency(p.applied_to_fees)} fees
                      </td>
                      <td className="text-xs text-text-muted">{truncate(p.notes || '', 40)}</td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button
                            className="text-text-muted hover:text-accent-blue transition-colors p-0.5"
                            onClick={() => onOpenModal('payment', p.id)}
                            title="Edit payment"
                          >
                            <Pencil size={11} />
                          </button>
                          <button
                            className="text-text-muted hover:text-accent-expense transition-colors p-0.5"
                            onClick={() => handleDeletePayment(p.id)}
                            title="Delete payment"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── Right Column (2/5 = 40%) ── */}
        <div className="lg:col-span-2 space-y-4">
          {/* Card 4 — Communication Log */}
          <div className="block-card p-6">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-border-primary">
              <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
                Communication Log
              </h3>
              <button
                className="block-btn flex items-center gap-1 text-xs"
                onClick={() => onOpenModal('communication')}
              >
                <MessageSquare size={12} />
                Log
              </button>
            </div>
            {communications.length === 0 ? (
              <p className="text-sm text-text-muted">No communications logged</p>
            ) : (
              <div className="space-y-3 max-h-80 overflow-y-auto">
                {communications.map((c) => (
                  <div
                    key={c.id}
                    className="flex gap-3 p-3 border border-border-primary"
                    style={{ borderRadius: '6px', background: 'rgba(18,20,28,0.80)' }}
                  >
                    <div className="flex-shrink-0 text-text-muted mt-0.5">
                      {commIcon[c.type] || <MessageSquare size={14} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-bold text-text-primary">
                          {c.direction === 'outbound' ? (
                            <span className="inline-flex items-center gap-1">
                              <ArrowRight size={10} className="text-blue-400" /> Outbound
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <ArrowLeft size={10} className="text-green-400" /> Inbound
                            </span>
                          )}
                        </span>
                        <span className="text-[10px] text-text-muted font-mono">
                          {formatDate(c.logged_at, { style: 'short' })}
                        </span>
                        <button
                          className="ml-auto text-text-muted hover:text-accent-blue transition-colors p-0.5"
                          onClick={() => onOpenModal('communication', c.id)}
                          title="Edit communication"
                        >
                          <Pencil size={11} />
                        </button>
                        <button
                          className="text-text-muted hover:text-accent-expense transition-colors p-0.5"
                          onClick={() => handleDeleteComm(c.id)}
                          title="Delete communication"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                      {c.subject && (
                        <p className="text-xs font-semibold text-text-primary mb-0.5">
                          {c.subject}
                        </p>
                      )}
                      {c.body && (
                        <p className="text-xs text-text-muted">{truncate(c.body, 100)}</p>
                      )}
                      {c.outcome && (
                        <p className="text-xs italic text-text-secondary mt-0.5">
                          Outcome: {c.outcome}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Card 4b — Promise-to-Pay Timeline */}
          <div className="block-card p-6">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div className="text-xs font-semibold text-text-muted uppercase tracking-wider">Promise-to-Pay</div>
              <button className="block-btn text-xs py-1 px-3" onClick={() => setShowPromiseForm(v => !v)}>
                + Add Promise
              </button>
            </div>

            {showPromiseForm && (
              <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr 1fr auto', gap: 8, marginBottom: 16, alignItems: 'end' }}>
                <div>
                  <label className="block text-xs text-text-muted mb-1">Promise Date</label>
                  <input type="date" className="block-input" value={promiseForm.promised_date} onChange={(e) => setPromiseForm(p => ({...p, promised_date: e.target.value}))} />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">Amount</label>
                  <input type="number" min={0} step="0.01" className="block-input" value={promiseForm.promised_amount} onChange={(e) => setPromiseForm(p => ({...p, promised_amount: parseFloat(e.target.value) || 0}))} placeholder="0.00" />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">Notes</label>
                  <input className="block-input" value={promiseForm.notes} onChange={(e) => setPromiseForm(p => ({...p, notes: e.target.value}))} placeholder="Optional notes" />
                </div>
                <button className="block-btn text-xs py-1 px-3" onClick={savePromise}>Save</button>
              </div>
            )}

            {promises.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic', textAlign: 'center', padding: '12px 0' }}>
                No promises recorded.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {promises.map((p: any) => {
                  const isPast = p.promised_date < new Date().toISOString().slice(0, 10);
                  const badgeColor = p.kept ? '#16a34a' : isPast ? '#ef4444' : '#d97706';
                  const badgeLabel = p.kept ? 'Kept' : isPast ? 'Broken' : 'Pending';
                  return (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: 'var(--color-bg-secondary)', borderRadius: 6 }}>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', minWidth: 90 }}>{p.promised_date}</div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{formatCurrency(Number(p.promised_amount))}</div>
                      {p.notes && <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', flex: 1 }}>{p.notes}</div>}
                      <div style={{ flex: 1 }} />
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: badgeColor + '22', color: badgeColor, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                        {badgeLabel}
                      </span>
                      <button
                        onClick={() => togglePromiseKept(p.id, Boolean(p.kept))}
                        style={{ fontSize: 11, color: 'var(--color-text-muted)', background: 'none', border: '1px solid var(--color-border-primary)', borderRadius: 6, padding: '2px 8px', cursor: 'pointer' }}
                      >
                        {p.kept ? 'Mark Broken' : 'Mark Kept'}
                      </button>
                      <button
                        onClick={() => handleDeletePromise(p.id)}
                        style={{ fontSize: 11, color: 'var(--color-text-muted)', background: 'none', border: '1px solid var(--color-border-primary)', borderRadius: 6, padding: '2px 8px', cursor: 'pointer' }}
                        title="Delete promise"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Card 4c — Payment Plan */}
          <PaymentPlanCard debtId={debtId} balanceDue={debt.balance_due} onRefresh={triggerRefresh} />

          {/* Card 4d — Settlement Offers */}
          <SettlementCard debtId={debtId} balanceDue={debt.balance_due} onRefresh={onRefresh} />

          {/* Card 4e — FDCPA Compliance Log */}
          <ComplianceLog debtId={debtId} onRefresh={triggerRefresh} />

          {/* Card 4f — Disputes */}
          <div className="block-card p-6">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-border-primary">
              <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
                Disputes
              </h3>
              <button
                className="block-btn flex items-center gap-1 text-xs"
                onClick={() => { setEditingDisputeId(null); setDisputeForm({ reason: 'other', description: '', status: 'open' }); setShowDisputeForm(v => !v); }}
              >
                <Plus size={12} />
                File Dispute
              </button>
            </div>

            {showDisputeForm && (
              <div className="mb-4 p-3 border border-border-primary space-y-3" style={{ borderRadius: '6px', background: 'rgba(18,20,28,0.90)' }}>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-text-muted mb-1">Reason</label>
                    <select className="block-select" value={disputeForm.reason} onChange={(e) => setDisputeForm(f => ({ ...f, reason: e.target.value }))}>
                      <option value="not_my_debt">Not My Debt</option>
                      <option value="wrong_amount">Wrong Amount</option>
                      <option value="already_paid">Already Paid</option>
                      <option value="statute_expired">Statute Expired</option>
                      <option value="identity_theft">Identity Theft</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-text-muted mb-1">Status</label>
                    <select className="block-select" value={disputeForm.status} onChange={(e) => setDisputeForm(f => ({ ...f, status: e.target.value }))}>
                      <option value="open">Open</option>
                      <option value="investigating">Investigating</option>
                      <option value="resolved">Resolved</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">Description</label>
                  <textarea className="block-input" rows={2} placeholder="Dispute details..." value={disputeForm.description} onChange={(e) => setDisputeForm(f => ({ ...f, description: e.target.value }))} style={{ resize: 'vertical' }} />
                </div>
                <div className="flex gap-2">
                  <button className="block-btn-primary text-xs" onClick={handleSaveDispute} disabled={disputeSaving}>
                    {disputeSaving ? 'Saving...' : editingDisputeId ? 'Update' : 'Save'}
                  </button>
                  <button className="block-btn text-xs" onClick={() => setShowDisputeForm(false)}>Cancel</button>
                </div>
              </div>
            )}

            {disputes.length === 0 && !showDisputeForm ? (
              <p className="text-sm text-text-muted">No disputes filed</p>
            ) : (
              <div className="space-y-2">
                {disputes.map((d: any) => {
                  const statusColor: Record<string, string> = { open: '#d97706', investigating: '#3b82f6', resolved: '#16a34a', rejected: '#ef4444' };
                  const reasonLabels: Record<string, string> = { not_my_debt: 'Not My Debt', wrong_amount: 'Wrong Amount', already_paid: 'Already Paid', statute_expired: 'Statute Expired', identity_theft: 'Identity Theft', other: 'Other' };
                  return (
                    <div key={d.id} className="flex items-center justify-between p-2.5 border border-border-primary" style={{ borderRadius: '6px', background: 'rgba(18,20,28,0.80)' }}>
                      <div className="flex items-center gap-2 min-w-0">
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: (statusColor[d.status] || '#777') + '22', color: statusColor[d.status] || '#777', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          {d.status}
                        </span>
                        <span className="text-xs text-text-primary font-medium">{reasonLabels[d.reason] || d.reason}</span>
                        {d.description && <span className="text-xs text-text-muted truncate ml-1">— {d.description.slice(0, 50)}</span>}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-[10px] text-text-muted font-mono">{formatDate(d.dispute_date || d.created_at, { style: 'short' })}</span>
                        <button className="text-text-muted hover:text-accent-blue transition-colors p-0.5" onClick={() => handleEditDispute(d)} title="Edit"><Pencil size={11} /></button>
                        <button className="text-text-muted hover:text-accent-expense transition-colors p-0.5" onClick={() => handleDeleteDispute(d.id)} title="Delete"><Trash2 size={11} /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Card 5 — Evidence Items */}
          <div className="block-card p-6">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-border-primary">
              <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
                Evidence Items
              </h3>
              <button
                className="block-btn flex items-center gap-1 text-xs"
                onClick={() => onOpenModal('evidence')}
              >
                <FileText size={12} />
                Add
              </button>
            </div>
            {evidence.length === 0 ? (
              <p className="text-sm text-text-muted">No evidence items</p>
            ) : (
              <div className="space-y-2">
                {evidence.map((e) => {
                  const relevanceClass =
                    e.court_relevance === 'high'
                      ? 'block-badge block-badge-expense'
                      : e.court_relevance === 'medium'
                        ? 'block-badge block-badge-warning'
                        : 'block-badge block-badge-blue';
                  const typeBadge = formatStatus(e.type);
                  return (
                    <div
                      key={e.id}
                      className="flex items-center justify-between p-2.5 border border-border-primary"
                      style={{ borderRadius: '6px', background: 'rgba(18,20,28,0.80)' }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={typeBadge.className}>{typeBadge.label}</span>
                        <span className="text-xs text-text-primary font-medium truncate">
                          {e.title}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`${relevanceClass} capitalize`}>{e.court_relevance}</span>
                        <span className="text-[10px] text-text-muted font-mono">
                          {formatDate(e.date_of_evidence || e.created_at, { style: 'short' })}
                        </span>
                        <button
                          className="text-text-muted hover:text-accent-blue transition-colors p-0.5"
                          onClick={() => onOpenModal('evidence', e.id)}
                          title="Edit evidence"
                        >
                          <Pencil size={11} />
                        </button>
                        <button
                          className="text-text-muted hover:text-accent-expense transition-colors p-0.5"
                          onClick={() => handleDeleteEvidence(e.id)}
                          title="Delete evidence"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Card 6 — Legal Actions */}
          <div className="block-card p-6">
            <SectionLabel>Legal Actions</SectionLabel>
            {legalActions.length === 0 ? (
              <p className="text-sm text-text-muted">No legal actions</p>
            ) : (
              <div className="space-y-3">
                {legalActions.map((la) => {
                  const typeBadge = formatStatus(la.action_type);
                  const legalStatusBadge = formatStatus(la.status);
                  const checklist = parseChecklist(la.checklist_json);
                  const checklistPct =
                    checklist.total > 0 ? (checklist.done / checklist.total) * 100 : 0;
                  const hearingDays = la.hearing_date ? daysUntil(la.hearing_date) : null;

                  return (
                    <div
                      key={la.id}
                      className="p-3 border border-border-primary"
                      style={{ borderRadius: '6px', background: 'rgba(18,20,28,0.80)' }}
                    >
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className={typeBadge.className}>{typeBadge.label}</span>
                        <span className={legalStatusBadge.className}>{legalStatusBadge.label}</span>
                        {la.case_number && (
                          <span className="text-xs font-mono text-text-muted">
                            #{la.case_number}
                          </span>
                        )}
                        <span className="flex-1" />
                        <button
                          className="text-text-muted hover:text-accent-expense transition-colors p-0.5"
                          onClick={() => handleDeleteLegalAction(la.id)}
                          title="Delete legal action"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      {la.hearing_date && (
                        <div className="flex items-center gap-2 text-xs text-text-secondary mb-2">
                          <Calendar size={12} />
                          <span>Hearing: {formatDate(la.hearing_date)}</span>
                          {hearingDays !== null && hearingDays > 0 && (
                            <span className="text-text-muted">
                              ({hearingDays} day{hearingDays !== 1 ? 's' : ''} away)
                            </span>
                          )}
                          {hearingDays !== null && hearingDays <= 0 && (
                            <span className="text-red-400">
                              (past)
                            </span>
                          )}
                        </div>
                      )}
                      {checklist.total > 0 && (
                        <div className="mt-1">
                          <div className="flex items-center justify-between text-[10px] text-text-muted mb-1">
                            <span>Checklist</span>
                            <span>
                              {checklist.done}/{checklist.total}
                            </span>
                          </div>
                          <div
                            className="w-full h-1.5 bg-bg-tertiary"
                            style={{ borderRadius: '6px' }}
                          >
                            <div
                              className="h-full bg-accent-blue"
                              style={{
                                width: `${checklistPct}%`,
                                borderRadius: '6px',
                                transition: 'width 0.3s ease',
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Card 6b — Installment Calendar */}
          {installments.length > 0 && (
            <div className="block-card p-6">
              <SectionLabel>Payment Installments</SectionLabel>
              {(() => {
                const today = new Date().toISOString().slice(0, 10);
                const paid = installments.filter((i: any) => i.paid);
                const overdue = installments.filter((i: any) => !i.paid && i.due_date < today);
                const upcoming = installments.filter((i: any) => !i.paid && i.due_date >= today);
                return (
                  <>
                    <div className="flex gap-3 mb-3 text-xs">
                      <span className="text-accent-income font-bold">{paid.length} Paid</span>
                      <span className="text-text-muted">·</span>
                      <span className="text-accent-blue font-bold">{upcoming.length} Upcoming</span>
                      <span className="text-text-muted">·</span>
                      <span className="text-accent-expense font-bold">{overdue.length} Overdue</span>
                    </div>
                    <div className="space-y-1.5 max-h-60 overflow-y-auto">
                      {installments.map((inst: any, idx: number) => {
                        const isPaid = !!inst.paid;
                        const isOverdue = !isPaid && inst.due_date < today;
                        const color = isPaid ? '#16a34a' : isOverdue ? '#ef4444' : '#3b82f6';
                        const label = isPaid ? 'Paid' : isOverdue ? 'Overdue' : 'Due';
                        return (
                          <div key={inst.id || idx} className="flex items-center justify-between px-2.5 py-1.5 border border-border-primary" style={{ borderRadius: '6px', borderLeftWidth: 3, borderLeftColor: color }}>
                            <span className="text-xs font-mono text-text-secondary">{formatDate(inst.due_date)}</span>
                            <span className="text-xs font-mono font-bold text-text-primary">{formatCurrency(inst.amount || 0)}</span>
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 6, background: color + '22', color }}>{label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* Card 6c — Documents & Attachments */}
          <div className="block-card p-6">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-border-primary">
              <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
                Documents
              </h3>
              <button className="block-btn flex items-center gap-1 text-xs" onClick={handleUploadDocument}>
                <Plus size={12} />
                Upload
              </button>
            </div>
            {documents.length === 0 ? (
              <p className="text-sm text-text-muted">No documents attached</p>
            ) : (
              <div className="space-y-1.5">
                {documents.map((doc: any) => (
                  <div key={doc.id} className="flex items-center justify-between p-2 border border-border-primary" style={{ borderRadius: '6px', background: 'rgba(18,20,28,0.80)' }}>
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText size={14} className="text-accent-blue flex-shrink-0" />
                      <span className="text-xs text-text-primary font-medium truncate">{doc.filename}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[10px] text-text-muted font-mono">{formatDate(doc.uploaded_at, { style: 'short' })}</span>
                      <button className="text-text-muted hover:text-accent-expense transition-colors p-0.5" onClick={() => handleDeleteDocument(doc.id)} title="Delete"><Trash2 size={11} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Card — Chain of Custody Audit Log */}
          <div className="block-card p-6">
            <SectionLabel>Chain of Custody</SectionLabel>
            {auditLog.length === 0 ? (
              <p className="text-sm text-text-muted">No audit entries yet.</p>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {auditLog.map((entry: any) => {
                  const actionLabels: Record<string, string> = {
                    stage_advance: 'Stage Advanced',
                    hold_toggle: 'Hold Toggled',
                    assignment_change: 'Collector Assigned',
                    fee_added: 'Fee Added',
                    settlement_accepted: 'Settlement Accepted',
                    settlement_offered: 'Settlement Offered',
                    compliance_event: 'Compliance Event',
                    plan_created: 'Payment Plan Created',
                    promise_recorded: 'Promise Recorded',
                    promise_updated: 'Promise Updated',
                    note_added: 'Note Added',
                    field_edit: 'Field Updated',
                    payment_recorded: 'Payment Recorded',
                    communication_logged: 'Communication Logged',
                    dispute_filed: 'Dispute Filed',
                    record_deleted: 'Record Deleted',
                    interest_recalculated: 'Interest Recalculated',
                  };
                  const label = actionLabels[entry.action] || entry.action;
                  return (
                    <div key={entry.id} className="flex items-start gap-2 px-2 py-1.5 border-l-2 border-border-primary text-xs">
                      <span className="text-text-muted font-mono whitespace-nowrap flex-shrink-0">
                        {formatDate(entry.performed_at, { style: 'short' })}
                      </span>
                      <div className="min-w-0">
                        <span className="text-text-primary font-semibold">{label}</span>
                        {entry.field_name && (
                          <span className="text-text-muted ml-1">({entry.field_name})</span>
                        )}
                        {entry.old_value && entry.new_value && (
                          <span className="text-text-muted ml-1">
                            {entry.old_value} &rarr; {entry.new_value}
                          </span>
                        )}
                        {!entry.old_value && entry.new_value && (
                          <span className="text-text-muted ml-1">: {entry.new_value}</span>
                        )}
                      </div>
                      <span className="text-[10px] text-text-muted ml-auto flex-shrink-0 capitalize">{entry.performed_by}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Card 7 — Activity Timeline + Quick Note */}
          <div className="block-card p-6">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-border-primary">
              <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
                Activity Timeline
              </h3>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{timeline.length} events</span>
            </div>

            {/* Quick Note */}
            <div className="flex gap-2 mb-4">
              <input
                className="block-input flex-1"
                placeholder="Add a quick note..."
                value={quickNote}
                onChange={e => setQuickNote(e.target.value)}
                onKeyDown={async e => {
                  if (e.key === 'Enter' && quickNote.trim()) {
                    setSavingNote(true);
                    try {
                      await api.addQuickNote(debtId, quickNote.trim());
                      setQuickNote('');
                      triggerRefresh();
                    } finally {
                      setSavingNote(false);
                    }
                  }
                }}
              />
              <button
                className="block-btn-primary text-xs py-1 px-3"
                disabled={savingNote || !quickNote.trim()}
                onClick={async () => {
                  if (!quickNote.trim()) return;
                  setSavingNote(true);
                  try {
                    await api.addQuickNote(debtId, quickNote.trim());
                    setQuickNote('');
                    triggerRefresh();
                  } finally {
                    setSavingNote(false);
                  }
                }}
              >
                {savingNote ? '...' : 'Note'}
              </button>
            </div>

            {timeline.length === 0 ? (
              <p className="text-sm text-text-muted">No activity recorded yet.</p>
            ) : (
              <div className="relative pl-5" style={{ maxHeight: 400, overflowY: 'auto' }}>
                <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border-primary" />
                <div className="space-y-3">
                  {timeline.map((ev) => {
                    const kindColors: Record<string, string> = {
                      comm: '#60a5fa',
                      stage: '#a78bfa',
                      payment: '#22c55e',
                      promise: '#f59e0b',
                      compliance: '#f97316',
                      settlement: '#06b6d4',
                      note: '#94a3b8',
                    };
                    const dotColor = kindColors[ev.kind] || '#94a3b8';
                    const ts = ev.ts ? ev.ts.slice(0, 10) : '';
                    return (
                      <div key={ev.id} className="relative flex gap-3 items-start">
                        <div
                          className="absolute -left-5 top-1.5 w-2.5 h-2.5 flex-shrink-0"
                          style={{ background: dotColor, borderRadius: 6 }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span style={{ fontSize: 11, fontWeight: 700, color: dotColor }}>{ev.label}</span>
                            <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>{ts}</span>
                          </div>
                          {ev.detail && (
                            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 1 }}>
                              {ev.detail}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Card 8 — Pipeline History */}
          <div className="block-card p-6">
            <SectionLabel>Pipeline History</SectionLabel>
            {pipelineStages.length === 0 ? (
              <p className="text-sm text-text-muted">No pipeline history</p>
            ) : (
              <div className="relative pl-5">
                {/* Vertical line */}
                <div
                  className="absolute left-[7px] top-2 bottom-2 w-px bg-border-primary"
                />
                <div className="space-y-4">
                  {pipelineStages.map((ps, idx) => {
                    const isCurrent = !ps.exited_at;
                    const stgBadge = formatStatus(ps.stage);
                    const dotColor = stageColor[ps.stage] || 'bg-bg-secondary';
                    return (
                      <div key={ps.id} className="relative flex gap-3 items-start">
                        {/* Dot */}
                        <div
                          className={`absolute -left-5 top-1 w-3 h-3 ${dotColor} flex-shrink-0`}
                          style={{
                            borderRadius: '6px',
                            animation: isCurrent ? 'pulse 2s infinite' : undefined,
                          }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={stgBadge.className}>{stgBadge.label}</span>
                            {ps.auto_advanced ? (
                              <span
                                className="text-[10px] text-yellow-400 flex items-center gap-0.5"
                                title="Auto-advanced"
                              >
                                <Zap size={10} /> auto
                              </span>
                            ) : null}
                            {isCurrent && (
                              <span className="text-[10px] font-bold text-green-400 uppercase">
                                Current
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-text-muted mt-0.5 font-mono">
                            {formatDate(ps.entered_at, { style: 'short' })}
                            {ps.exited_at && (
                              <>
                                {' '}
                                &rarr; {formatDate(ps.exited_at, { style: 'short' })}
                              </>
                            )}
                            <span className="ml-2 text-text-secondary">
                              ({durationStr(ps.entered_at, ps.exited_at)})
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Cross-entity integration ────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 mt-6">
        <RelatedPanel entityType="debt" entityId={debtId} hide={['comms', 'evidence', 'contacts', 'payments']} />
        <EntityTimeline entityType="debts" entityId={debtId} />
      </div>

      {/* Pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
};

export default DebtDetail;
