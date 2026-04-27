import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  role: string;
  avatar_color: string;
}

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  setUser: (user: AuthUser | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      setUser: (user) => set({ user, isAuthenticated: !!user }),
      logout: () => set({ user: null, isAuthenticated: false }),
    }),
    {
      name: 'bap-auth',
      version: 1,
      // Persist both user and isAuthenticated so Cmd+R reloads don't log out the user.
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
      // Drop persisted state on schema mismatch rather than crashing on hydrate.
      migrate: (persisted: any, _version: number) => {
        if (!persisted || typeof persisted !== 'object') return { user: null, isAuthenticated: false } as any;
        return persisted;
      },
    }
  )
);
