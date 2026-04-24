import React, { useEffect, useState, useCallback } from 'react';
import { FileText, Gavel, Clock, Scale, Package } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate, formatStatus } from '../../lib/format';
import DemandLetterGenerator from './DemandLetterGenerator';
import CourtFilingTracker from './CourtFilingTracker';
import StatuteTracker from './StatuteTracker';
import BundleExport from './BundleExport';
import ErrorBanner from '../../components/ErrorBanner';

// ─── Types ──────────────────────────────────────────────
type SubTab = 'evidence' | 'demand_letters' | 'court_filings' | 'statute_tracker' | 'bundle' | 'audit_trail' | 'court_packet';

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

// ─── Audit Trail View ──────────────────────────────────
const AuditTrailView: React.FC<{ debtId: string }> = ({ debtId }) => {
  const [entries, setEntries] = useState<any[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.debtAuditLog(debtId, 500).then(r => {
      setEntries(Array.isArray(r) ? r : []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [debtId]);

  const filtered = filter
    ? entries.filter(e => e.action.includes(filter) || (e.field_name || '').includes(filter) || (e.new_value || '').toLowerCase().includes(filter.toLowerCase()))
    : entries;

  if (loading) return <div className="text-text-muted text-sm text-center py-8">Loading audit trail...</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <input
          className="block-input flex-1"
          placeholder="Filter by action, field, or value..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="text-xs text-text-muted">{filtered.length} entries</span>
      </div>
      {filtered.length === 0 ? (
        <div className="text-text-muted text-sm text-center py-8">No audit entries{filter ? ' matching filter' : ''}.</div>
      ) : (
        <div className="space-y-1 max-h-[60vh] overflow-y-auto">
          {filtered.map((entry: any) => {
            const labels: Record<string, string> = {
              stage_advance: 'Stage Advanced', hold_toggle: 'Hold Toggled', assignment_change: 'Collector Assigned',
              fee_added: 'Fee Added', settlement_accepted: 'Settlement Accepted', settlement_offered: 'Settlement Offered',
              compliance_event: 'Compliance Event', plan_created: 'Plan Created', promise_recorded: 'Promise Recorded',
              promise_updated: 'Promise Updated', note_added: 'Note Added', field_edit: 'Field Updated',
              payment_recorded: 'Payment Recorded', communication_logged: 'Communication Logged',
              dispute_filed: 'Dispute Filed', record_deleted: 'Record Deleted', interest_recalculated: 'Interest Recalculated',
            };
            return (
              <div key={entry.id} className="flex items-start gap-3 px-3 py-2 border-l-2 border-border-primary text-xs hover:bg-bg-hover" style={{ borderRadius: '0 6px 6px 0' }}>
                <span className="text-text-muted font-mono whitespace-nowrap">{formatDate(entry.performed_at, { style: 'short' })}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-text-primary font-semibold">{labels[entry.action] || entry.action}</span>
                  {entry.field_name && <span className="text-text-muted ml-1">({entry.field_name})</span>}
                  {entry.old_value && entry.new_value && <span className="text-text-muted ml-1">{entry.old_value} → {entry.new_value}</span>}
                  {!entry.old_value && entry.new_value && <span className="text-text-muted ml-1">: {entry.new_value}</span>}
                </div>
                <span className="text-[10px] text-text-muted capitalize flex-shrink-0">{entry.performed_by}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ─── Component ──────────────────────────────────────────
const LegalToolkit: React.FC<LegalToolkitProps> = ({ onOpenEvidence }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [subTab, setSubTab] = useState<SubTab>('demand_letters');
  const [debts, setDebts] = useState<DebtOption[]>([]);
  const [selectedDebtId, setSelectedDebtId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // ── Load debts in collection/legal status ──
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      setLoading(true);
      setError('');
      try {
        const data = await api.rawQuery(
          "SELECT id, debtor_name, balance_due, status FROM debts WHERE company_id = ? AND status IN ('active','in_collection','legal','disputed') ORDER BY debtor_name",
          [activeCompany.id]
        );
        if (cancelled) return;
        setDebts(Array.isArray(data) ? data : []);
      } catch (err: any) {
        console.error('Failed to load debts for legal toolkit:', err);
        if (!cancelled) setError(err?.message || 'Failed to load debts for legal toolkit');
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
      {error && <ErrorBanner message={error} title="Failed to load debts for legal toolkit" onDismiss={() => setError('')} />}
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
        <SubTabBtn
          active={subTab === 'audit_trail'}
          icon={<Clock size={14} />}
          label="Audit Trail"
          onClick={() => setSubTab('audit_trail')}
        />
        <SubTabBtn
          active={subTab === 'court_packet'}
          icon={<Scale size={14} />}
          label="Court Packet"
          onClick={() => setSubTab('court_packet')}
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

      {!selectedDebtId && subTab !== 'evidence' && subTab !== 'statute_tracker' && subTab !== 'bundle' && subTab !== 'audit_trail' && subTab !== 'court_packet' && (
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

      {subTab === 'audit_trail' && !selectedDebtId && (
        <div className="block-card text-center py-12">
          <Clock size={32} className="mx-auto text-text-muted mb-3" />
          <p className="text-text-muted text-sm">Select a debt above to view the audit trail.</p>
        </div>
      )}

      {subTab === 'audit_trail' && selectedDebtId && (
        <AuditTrailView debtId={selectedDebtId} />
      )}

      {subTab === 'court_packet' && !selectedDebtId && (
        <div className="block-card text-center py-12">
          <Scale size={32} className="mx-auto text-text-muted mb-3" />
          <p className="text-text-muted text-sm">Select a debt above to generate a court packet.</p>
        </div>
      )}

      {subTab === 'court_packet' && selectedDebtId && (
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Generate a comprehensive court-ready document package for the selected debt.
            The packet includes all communications, payments, evidence, compliance records,
            audit trail, settlements, contacts, and disputes.
          </p>
          <div className="flex gap-3">
            <button
              className="block-btn-primary flex items-center gap-2"
              onClick={async () => {
                const data = await api.generateCourtPacket(selectedDebtId);
                if (data?.error) return;
                const { generateCourtPacketHTML } = await import('../../lib/print-templates');
                const html = generateCourtPacketHTML(data);
                await api.printPreview(html, 'Court Packet');
              }}
            >
              <Scale size={14} />
              Generate Court Packet
            </button>
            <button
              className="block-btn flex items-center gap-2"
              onClick={async () => {
                const debt = await api.get('debts', selectedDebtId);
                if (!debt) return;
                const { generateVerificationAffidavitHTML } = await import('../../lib/print-templates');
                const html = generateVerificationAffidavitHTML(debt, activeCompany, activeCompany?.name || '');
                await api.printPreview(html, 'Verification Affidavit');
              }}
            >
              <FileText size={14} />
              Generate Affidavit
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default LegalToolkit;
