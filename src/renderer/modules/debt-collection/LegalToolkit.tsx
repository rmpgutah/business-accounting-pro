import React, { useEffect, useState, useCallback } from 'react';
import { FileText, Gavel, Clock, Scale, Package } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatStatus } from '../../lib/format';
import DemandLetterGenerator from './DemandLetterGenerator';
import CourtFilingTracker from './CourtFilingTracker';
import StatuteTracker from './StatuteTracker';
import BundleExport from './BundleExport';

// ─── Types ──────────────────────────────────────────────
type SubTab = 'evidence' | 'demand_letters' | 'court_filings' | 'statute_tracker' | 'bundle';

interface LegalToolkitProps {
  onOpenEvidence: () => void;
}

interface DebtOption {
  id: string;
  debtor_name: string;
  balance_due: number;
  status: string;
}

// ─── Sub-Tab Button ─────────────────────────────────────
const SubTabBtn: React.FC<{
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}> = ({ active, icon, label, onClick }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold transition-colors ${
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

// ─── Component ──────────────────────────────────────────
const LegalToolkit: React.FC<LegalToolkitProps> = ({ onOpenEvidence }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [subTab, setSubTab] = useState<SubTab>('demand_letters');
  const [debts, setDebts] = useState<DebtOption[]>([]);
  const [selectedDebtId, setSelectedDebtId] = useState<string>('');
  const [loading, setLoading] = useState(true);

  // ── Load debts in collection/legal status ──
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      setLoading(true);
      try {
        const data = await api.rawQuery(
          "SELECT id, debtor_name, balance_due, status FROM debts WHERE company_id = ? AND status IN ('active','in_collection','legal','disputed') ORDER BY debtor_name",
          [activeCompany.id]
        );
        if (cancelled) return;
        setDebts(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Failed to load debts for legal toolkit:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeCompany]);

  const handleDebtChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedDebtId(e.target.value);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading Legal Toolkit...
      </div>
    );
  }

  return (
    <div>
      {/* Debt Selector */}
      <div className="block-card mb-4">
        <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
          Select Debt
        </label>
        <select
          className="block-select w-full"
          value={selectedDebtId}
          onChange={handleDebtChange}
        >
          <option value="">-- Select a debt --</option>
          {debts.map((d) => {
            const st = formatStatus(d.status);
            return (
              <option key={d.id} value={d.id}>
                {d.debtor_name} - {formatCurrency(d.balance_due)} ({st.label})
              </option>
            );
          })}
        </select>
      </div>

      {/* Sub-tab bar */}
      <div className="flex border-b border-border-primary mb-4">
        <SubTabBtn
          active={subTab === 'demand_letters'}
          icon={<FileText size={14} />}
          label="Demand Letters"
          onClick={() => setSubTab('demand_letters')}
        />
        <SubTabBtn
          active={subTab === 'court_filings'}
          icon={<Gavel size={14} />}
          label="Court Filings"
          onClick={() => setSubTab('court_filings')}
        />
        <SubTabBtn
          active={subTab === 'statute_tracker'}
          icon={<Clock size={14} />}
          label="Statute Tracker"
          onClick={() => setSubTab('statute_tracker')}
        />
        <SubTabBtn
          active={subTab === 'evidence'}
          icon={<Scale size={14} />}
          label="Evidence"
          onClick={() => setSubTab('evidence')}
        />
        <SubTabBtn
          active={subTab === 'bundle'}
          icon={<Package size={14} />}
          label="Export Bundle"
          onClick={() => setSubTab('bundle')}
        />
      </div>

      {/* Content */}
      {subTab === 'evidence' && (
        <div className="block-card text-center py-8">
          <Scale size={32} className="mx-auto text-text-muted mb-3" />
          <p className="text-text-muted text-sm mb-4">
            Open the Evidence panel from a debt detail view to manage evidence items.
          </p>
          <button className="block-btn-primary" onClick={onOpenEvidence}>
            Open Evidence Panel
          </button>
        </div>
      )}

      {subTab === 'statute_tracker' && activeCompany && (
        <StatuteTracker companyId={activeCompany.id} />
      )}

      {!selectedDebtId && subTab !== 'evidence' && subTab !== 'statute_tracker' && subTab !== 'bundle' && (
        <div className="block-card text-center py-12">
          <Gavel size={32} className="mx-auto text-text-muted mb-3" />
          <p className="text-text-muted text-sm">
            Select a debt above to use the Legal Toolkit.
          </p>
        </div>
      )}

      {selectedDebtId && subTab === 'demand_letters' && (
        <DemandLetterGenerator debtId={selectedDebtId} />
      )}

      {selectedDebtId && subTab === 'court_filings' && (
        <CourtFilingTracker debtId={selectedDebtId} />
      )}

      {subTab === 'bundle' && !selectedDebtId && (
        <div className="block-card text-center py-12">
          <Package size={32} className="mx-auto text-text-muted mb-3" />
          <p className="text-text-muted text-sm">
            Select a debt above to generate a court bundle.
          </p>
        </div>
      )}

      {selectedDebtId && subTab === 'bundle' && (
        <BundleExport debtId={selectedDebtId} />
      )}
    </div>
  );
};

export default LegalToolkit;
