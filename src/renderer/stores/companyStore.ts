import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Company } from '../../shared/types';

interface CompanyState {
  companies: Company[];
  activeCompany: Company | null;

  setCompanies: (companies: Company[]) => void;
  setActiveCompany: (company: Company | null) => void;
}

export const useCompanyStore = create<CompanyState>()(
  persist(
    (set) => ({
      companies: [],
      activeCompany: null,

      setCompanies: (companies) => set({ companies }),
      setActiveCompany: (company) => set({ activeCompany: company }),
    }),
    {
      name: 'bap-company',
      version: 1,
      // Persist only the active company id reference. The companies list is
      // re-fetched from the DB on every boot in App.tsx, so persisting it
      // bloats localStorage and writes on every render-driven setCompanies.
      partialize: (state) => ({ activeCompany: state.activeCompany }),
      // Drop persisted state on schema mismatch rather than crashing on hydrate.
      migrate: (persisted: any, _version: number) => {
        if (!persisted || typeof persisted !== 'object') return { activeCompany: null } as any;
        return persisted;
      },
    }
  )
);
