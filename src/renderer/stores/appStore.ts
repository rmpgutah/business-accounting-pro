import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AppState {
  currentModule: string;
  sidebarCollapsed: boolean;
  searchQuery: string;
  searchResults: Array<{ type: string; id: string; title: string; subtitle: string }>;
  searchOpen: boolean;
  notificationCount: number;
  loading: boolean;

  setModule: (module: string) => void;
  toggleSidebar: () => void;
  setSearchQuery: (query: string) => void;
  setSearchResults: (results: any[]) => void;
  setSearchOpen: (open: boolean) => void;
  setNotificationCount: (count: number) => void;
  setLoading: (loading: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      currentModule: 'dashboard',
      sidebarCollapsed: false,
      searchQuery: '',
      searchResults: [],
      searchOpen: false,
      notificationCount: 0,
      loading: true,

      setModule: (module) => set({ currentModule: module }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSearchQuery: (query) => set({ searchQuery: query }),
      setSearchResults: (results) => set({ searchResults: results }),
      setSearchOpen: (open) => set({ searchOpen: open }),
      setNotificationCount: (count) => set({ notificationCount: count }),
      setLoading: (loading) => set({ loading }),
    }),
    {
      name: 'bap-app',
      partialize: (state) => ({
        currentModule: state.currentModule,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    }
  )
);
