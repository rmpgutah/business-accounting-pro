import React, { useState, useEffect } from 'react';
import { Users2, Laptop, ChevronRight, Plus } from 'lucide-react';
import { useCompanyStore } from '../../stores/companyStore';
import { useOnboarding } from '../companies/useOnboarding';
import OnboardingWizard from '../../components/OnboardingWizard';
import api from '../../lib/api';

// ─── Types ──────────────────────────────────────────────
type HrTab = 'onboarding' | 'equipment';

// ─── HR Module ──────────────────────────────────────────
const HrModule: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [tab, setTab] = useState<HrTab>('onboarding');
  const { open: wizardOpen, launch, dismiss } = useOnboarding(activeCompany?.id ?? null);
  const [assessments, setAssessments] = useState<any[]>([]);
  const [assLoading, setAssLoading] = useState(false);

  useEffect(() => {
    if (tab !== 'equipment') return;
    setAssLoading(true);
    api
      .equipmentAssessmentList()
      .then((data) => setAssessments(Array.isArray(data) ? data : []))
      .catch(() => setAssessments([]))
      .finally(() => setAssLoading(false));
  }, [tab]);

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      {/* Header */}
      <div className="module-header">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary"
            style={{ borderRadius: 'var(--app-radius)' }}
          >
            <Users2 size={18} style={{ color: 'var(--accent-primary)' }} />
          </div>
          <div>
            <h2 className="module-title text-text-primary">HR Tools</h2>
            <p className="text-xs text-text-muted mt-0.5">
              Onboarding &amp; Equipment Management
            </p>
          </div>
        </div>
        {tab === 'equipment' ? (
          <button
            className="block-btn-primary flex items-center gap-2"
            onClick={() => {/* new assessment form — see EquipmentAssessmentModule.example.tsx */}}
          >
            <Plus size={16} /> New Assessment
          </button>
        ) : (
          <button className="block-btn flex items-center gap-2" onClick={launch}>
            <ChevronRight size={16} /> Launch Wizard
          </button>
        )}
      </div>

      {/* Tabs */}
      <div
        className="flex gap-1"
        style={{ borderBottom: '1px solid var(--color-border-hairline)' }}
      >
        {(['onboarding', 'equipment'] as HrTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-semibold uppercase tracking-wide transition-colors ${
              tab === t ? '' : 'text-text-muted hover:text-text-primary'
            }`}
            style={
              tab === t
                ? {
                    color: 'var(--accent-primary)',
                    borderBottom: '2px solid var(--accent-primary)',
                  }
                : undefined
            }
          >
            {t === 'onboarding' ? 'Onboarding' : 'Equipment'}
          </button>
        ))}
      </div>

      {/* Onboarding Tab */}
      {tab === 'onboarding' && (
        <div className="space-y-4">
          <div className="block-card p-6 space-y-3">
            <h3 className="text-sm font-semibold text-text-primary">Company Onboarding</h3>
            <p className="text-xs text-text-secondary leading-relaxed">
              Use the onboarding wizard to configure your company&rsquo;s industry preset, chart
              of accounts, and default settings. You can re-launch the wizard at any time.
            </p>
            <button
              className="block-btn-primary flex items-center gap-2 mt-2"
              onClick={launch}
            >
              <ChevronRight size={14} />
              {activeCompany
                ? `Configure ${activeCompany.name}`
                : 'Launch Onboarding Wizard'}
            </button>
          </div>
          <div className="block-card p-6 space-y-2">
            <h3 className="text-sm font-semibold text-text-primary">Employee Onboarding</h3>
            <p className="text-xs text-text-secondary leading-relaxed">
              Manage employee records, payroll, and HR data in the Human Resources module. Use
              the Equipment tab to create and track equipment assessments for employees.
            </p>
          </div>
        </div>
      )}

      {/* Equipment Tab */}
      {tab === 'equipment' && (
        <div className="space-y-4">
          {assLoading ? (
            <div className="text-text-muted text-sm font-mono text-center py-8">
              Loading assessments&hellip;
            </div>
          ) : assessments.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                <Laptop size={24} className="text-text-muted" />
              </div>
              <p className="text-sm text-text-secondary font-medium">
                No equipment assessments yet
              </p>
              <p className="text-xs text-text-muted mt-1">
                Create an assessment to track employee equipment and associated charges.
              </p>
            </div>
          ) : (
            <div className="block-card p-0 overflow-hidden">
              <table className="block-table">
                <thead>
                  <tr>
                    <th>Document ID</th>
                    <th>Employee</th>
                    <th className="text-right">Total Assessed</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {assessments.map((a) => (
                    <tr key={a.id}>
                      <td className="font-mono text-xs text-text-secondary">
                        {a.document_id}
                      </td>
                      <td className="text-text-primary">{a.employee_name}</td>
                      <td className="text-right font-mono text-text-secondary">
                        ${Number(a.total_assessed || 0).toFixed(2)}
                      </td>
                      <td className="text-xs text-text-muted">
                        {a.created_at
                          ? new Date(a.created_at).toLocaleDateString()
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Onboarding Wizard overlay */}
      {wizardOpen && activeCompany && (
        <OnboardingWizard
          companyId={activeCompany.id}
          onClose={dismiss}
          onComplete={dismiss}
        />
      )}
    </div>
  );
};

export default HrModule;
