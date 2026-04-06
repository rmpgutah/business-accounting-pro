import React, { useState, useCallback } from 'react';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  GitBranch,
  Gavel,
  BarChart3,
  Settings,
} from 'lucide-react';
import DebtList from './DebtList';
import DebtForm from './DebtForm';
import DebtDetail from './DebtDetail';
import DebtInvoiceFormatter from './DebtInvoiceFormatter';
import PaymentForm from './PaymentForm';
import CommunicationForm from './CommunicationForm';
import EvidenceForm from './EvidenceForm';
import ContactForm from './ContactForm';
import PipelineView from './PipelineView';
import LegalToolkit from './LegalToolkit';
import AnalyticsView from './AnalyticsView';
import AutomationSettings from './AutomationSettings';
import { useCompanyStore } from '../../stores/companyStore';

// ─── Types ──────────────────────────────────────────────
type Tab = 'receivables' | 'payables' | 'pipeline' | 'legal' | 'analytics';
type DebtView = 'list' | 'detail' | 'form' | 'invoice';
type DebtFormType = 'receivable' | 'payable';

interface ModalState {
  communication: boolean;
  payment: boolean;
  evidence: boolean;
  contact: boolean;
}

// ─── Tab Button ─────────────────────────────────────────
const TabBtn: React.FC<{
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}> = ({ active, icon, label, onClick }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-colors ${
      active
        ? 'bg-bg-tertiary text-text-primary border-b-2 border-accent-blue'
        : 'text-text-muted hover:text-text-secondary'
    }`}
    style={{ borderRadius: '6px 6px 0 0' }}
  >
    {icon}
    {label}
  </button>
);

// ─── Main Module ────────────────────────────────────────
const DebtCollectionModule: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [tab, setTab] = useState<Tab>('receivables');

  // View state
  const [view, setView] = useState<DebtView>('list');
  const [activeDebtId, setActiveDebtId] = useState<string | null>(null);
  const [debtFormType, setDebtFormType] = useState<DebtFormType>('receivable');
  const [listKey, setListKey] = useState(0);

  // Settings modal
  const [showSettings, setShowSettings] = useState(false);

  // Modal state
  const [modalState, setModalState] = useState<ModalState>({
    communication: false,
    payment: false,
    evidence: false,
    contact: false,
  });

  // ── Debt handlers ──
  const handleViewDebt = useCallback((id: string) => {
    setActiveDebtId(id);
    setView('detail');
  }, []);

  const handleNewDebt = useCallback((type: DebtFormType) => {
    setActiveDebtId(null);
    setDebtFormType(type);
    setView('form');
  }, []);

  const handleEditDebt = useCallback((id: string) => {
    setActiveDebtId(id);
    setView('form');
  }, []);

  const handleBack = useCallback(() => {
    setView('list');
    setActiveDebtId(null);
  }, []);

  const handleInvoice = useCallback((id: string) => {
    setActiveDebtId(id);
    setView('invoice');
  }, []);

  const handleBackFromInvoice = useCallback(() => {
    setView('detail');
  }, []);

  const handleSaved = useCallback(() => {
    setView('list');
    setActiveDebtId(null);
    setListKey((k) => k + 1);
  }, []);

  // ── Tab switch resets view ──
  const switchTab = useCallback((t: Tab) => {
    setTab(t);
    setView('list');
    setActiveDebtId(null);
  }, []);

  // ── Modal handlers ──
  const openModal = useCallback((modal: keyof ModalState) => {
    setModalState((prev) => ({ ...prev, [modal]: true }));
  }, []);

  const closeModal = useCallback((modal: keyof ModalState) => {
    setModalState((prev) => ({ ...prev, [modal]: false }));
  }, []);

  return (
    <div className="p-6 h-full overflow-y-auto">
      {/* Tabs */}
      <div className="flex items-center border-b border-border-primary mb-6">
        <TabBtn
          active={tab === 'receivables'}
          icon={<ArrowDownCircle size={16} />}
          label="Receivables"
          onClick={() => switchTab('receivables')}
        />
        <TabBtn
          active={tab === 'payables'}
          icon={<ArrowUpCircle size={16} />}
          label="Payables"
          onClick={() => switchTab('payables')}
        />
        <TabBtn
          active={tab === 'pipeline'}
          icon={<GitBranch size={16} />}
          label="Pipeline"
          onClick={() => switchTab('pipeline')}
        />
        <TabBtn
          active={tab === 'legal'}
          icon={<Gavel size={16} />}
          label="Legal Toolkit"
          onClick={() => switchTab('legal')}
        />
        <TabBtn
          active={tab === 'analytics'}
          icon={<BarChart3 size={16} />}
          label="Analytics"
          onClick={() => switchTab('analytics')}
        />
        <div className="ml-auto">
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center justify-center w-8 h-8 text-text-muted hover:text-text-primary transition-colors"
            style={{ borderRadius: '6px' }}
            title="Escalation Settings"
          >
            <Settings size={16} />
          </button>
        </div>
      </div>

      {/* Content — Invoice Statement view */}
      {view === 'invoice' && activeDebtId && (
        <DebtInvoiceFormatter
          debtId={activeDebtId}
          onBack={handleBackFromInvoice}
        />
      )}

      {/* Content — Detail view (any tab) */}
      {view === 'detail' && activeDebtId && (
        <DebtDetail
          debtId={activeDebtId}
          onBack={handleBack}
          onEdit={() => handleEditDebt(activeDebtId)}
          onRefresh={() => setListKey((k) => k + 1)}
          onOpenModal={openModal}
          onInvoice={() => handleInvoice(activeDebtId)}
        />
      )}

      {/* Content — Form view (any tab) */}
      {view === 'form' && (
        <DebtForm
          debtId={activeDebtId}
          debtType={debtFormType}
          onBack={handleBack}
          onSaved={handleSaved}
        />
      )}

      {/* Content — List views per tab */}
      {tab === 'receivables' && view === 'list' && (
        <DebtList
          key={listKey}
          type="receivable"
          onNew={() => handleNewDebt('receivable')}
          onView={handleViewDebt}
          onEdit={handleEditDebt}
        />
      )}

      {tab === 'payables' && view === 'list' && (
        <DebtList
          key={listKey}
          type="payable"
          onNew={() => handleNewDebt('payable')}
          onView={handleViewDebt}
          onEdit={handleEditDebt}
        />
      )}

      {tab === 'pipeline' && view === 'list' && (
        <PipelineView onViewDebt={handleViewDebt} />
      )}

      {tab === 'legal' && view === 'list' && (
        <LegalToolkit onOpenEvidence={() => openModal('evidence')} />
      )}

      {tab === 'analytics' && view === 'list' && (
        <AnalyticsView companyId={activeCompany?.id || ''} />
      )}

      {/* Modals — Communication */}
      {modalState.communication && activeDebtId && (
        <CommunicationForm
          debtId={activeDebtId}
          onClose={() => closeModal('communication')}
          onSaved={() => {
            closeModal('communication');
            setListKey((k) => k + 1);
          }}
        />
      )}

      {/* Modals — Payment */}
      {modalState.payment && activeDebtId && (
        <PaymentForm
          debtId={activeDebtId}
          onClose={() => closeModal('payment')}
          onSaved={() => {
            closeModal('payment');
            setListKey((k) => k + 1);
          }}
        />
      )}

      {/* Modals — Evidence */}
      {modalState.evidence && activeDebtId && (
        <EvidenceForm
          debtId={activeDebtId}
          onClose={() => closeModal('evidence')}
          onSaved={() => {
            closeModal('evidence');
            setListKey((k) => k + 1);
          }}
        />
      )}

      {/* Modals — Contact */}
      {modalState.contact && activeDebtId && (
        <ContactForm
          debtId={activeDebtId}
          onClose={() => closeModal('contact')}
          onSaved={() => {
            closeModal('contact');
            setListKey((k) => k + 1);
          }}
        />
      )}

      {/* Modals — Automation Settings */}
      {showSettings && (
        <AutomationSettings onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
};

export default DebtCollectionModule;
