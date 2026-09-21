import React from 'react';
import { useCompanyStore } from '../../stores/companyStore';
import { useOnboarding } from './useOnboarding';
import OnboardingWizard from '../../components/OnboardingWizard';
import MultiCompany from '../multi-company';

// ─── Companies Module ────────────────────────────────────
// Wraps the core Multi-Company management view and layers the
// onboarding wizard for freshly-created companies. The wizard
// auto-opens when a company is < 30 minutes old with no preset
// applied, and can be re-launched from HR Tools or the wizard
// trigger in the Onboarding wizard itself.
const Companies: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const { open: wizardOpen, dismiss } = useOnboarding(activeCompany?.id ?? null);

  return (
    <>
      <MultiCompany />
      {wizardOpen && activeCompany && (
        <OnboardingWizard
          companyId={activeCompany.id}
          onClose={dismiss}
          onComplete={dismiss}
        />
      )}
    </>
  );
};

export default Companies;
