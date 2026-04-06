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
    { name: 'bap-company' }
  )
);
