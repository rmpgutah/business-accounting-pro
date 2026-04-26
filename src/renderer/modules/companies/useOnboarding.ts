import { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';

// Hook controlling whether the OnboardingWizard should be shown for a company.
// The wizard auto-opens on first company creation (when no industry preset has
// been applied yet). Admins can also re-launch it manually (Feature #25).
//
// Detection rule: if the company has zero applied preset key and was created
// less than 30 minutes ago, treat as first-run.
export function useOnboarding(companyId: string | null) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);

  const checkFirstRun = useCallback(async () => {
    if (!companyId) { setChecked(true); return; }
    try {
      const presetKey = await api.getSetting('industry_preset_key');
      // If a preset has already been applied, we don't auto-open.
      if (presetKey && String(presetKey).length > 0) {
        setOpen(false);
        setChecked(true);
        return;
      }
      // Look at how many records exist on the company to decide if it's truly empty.
      const company = await api.getCompany(companyId);
      const created = company?.created_at ? new Date(company.created_at).getTime() : 0;
      const ageMin = (Date.now() - created) / 60000;
      // Consider new if < 30 minutes old AND no preset.
      // Skip persistent dismissal flag: per company, in localStorage.
      const dismissedKey = `onboarding_dismissed_${companyId}`;
      const dismissed = localStorage.getItem(dismissedKey) === '1';
      if (ageMin < 30 && !dismissed) {
        setOpen(true);
      }
    } catch { /* tolerate */ }
    setChecked(true);
  }, [companyId]);

  useEffect(() => {
    checkFirstRun();
  }, [checkFirstRun]);

  const dismiss = useCallback(() => {
    if (companyId) {
      try { localStorage.setItem(`onboarding_dismissed_${companyId}`, '1'); } catch { /* ignore */ }
    }
    setOpen(false);
  }, [companyId]);

  const launch = useCallback(() => {
    if (companyId) {
      try { localStorage.removeItem(`onboarding_dismissed_${companyId}`); } catch { /* ignore */ }
    }
    setOpen(true);
  }, [companyId]);

  return { open, checked, dismiss, launch, setOpen };
}
