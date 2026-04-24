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

  // Cross-module deep link: RelatedPanel and global search can push a focus
  // hint here, and target modules read + consume it after mount to auto-open
  // the right record.
  focusEntity: { type: string; id: string } | null;

  setModule: (module: string) => void;
  toggleSidebar: () => void;
  setSearchQuery: (query: string) => void;
  setSearchResults: (results: any[]) => void;
  setSearchOpen: (open: boolean) => void;
  setNotificationCount: (count: number) => void;
  setLoading: (loading: boolean) => void;
  setFocusEntity: (entity: { type: string; id: string } | null) => void;
  /** Read + clear the focus hint if and only if it targets `acceptedType`. */
  consumeFocusEntity: (acceptedType: string) => { type: string; id: string } | null;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      currentModule: 'dashboard',
      sidebarCollapsed: false,
      searchQuery: '',
      searchResults: [],
      searchOpen: false,
      notificationCount: 0,
      loading: true,
      focusEntity: null,

      setModule: (module) => set({ currentModule: module }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSearchQuery: (query) => set({ searchQuery: query }),
      setSearchResults: (results) => set({ searchResults: results }),
      setSearchOpen: (open) => set({ searchOpen: open }),
      setNotificationCount: (count) => set({ notificationCount: count }),
      setLoading: (loading) => set({ loading }),
      setFocusEntity: (entity) => set({ focusEntity: entity }),
      consumeFocusEntity: (acceptedType) => {
        const fe = get().focusEntity;
        if (fe && fe.type === acceptedType) {
          set({ focusEntity: null });
          return fe;
        }
        return null;
      },
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
