import { create } from 'zustand';
import type { Company } from '../../shared/types';

interface CompanyState {
  companies: Company[];
  activeCompany: Company | null;

  setCompanies: (companies: Company[]) => void;
  setActiveCompany: (company: Company | null) => void;
}

export const useCompanyStore = create<CompanyState>((set) => ({
  companies: [],
  activeCompany: null,

  setCompanies: (companies) => set({ companies }),
  setActiveCompany: (company) => set({ activeCompany: company }),
}));
