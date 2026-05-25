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

// WHO SYSTEM helper: push current-user changes down to the main process
// so logAudit() and other server-side who-tracking code attribute writes
// to the real authenticated user. Failures here only affect audit
// attribution — they should never block UI state changes.
function syncUserToMain(userId: string | null): void {
  if (typeof window === 'undefined') return;
  const api = (window as any).electronAPI;
  if (!api?.invoke) return;
  if (userId) api.invoke('auth:resume-session', { userId }).catch(() => {});
  else api.invoke('auth:logout').catch(() => {});
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      setUser: (user) => {
        set({ user, isAuthenticated: !!user });
        syncUserToMain(user?.id || null);
      },
      logout: () => {
        set({ user: null, isAuthenticated: false });
        syncUserToMain(null);
      },
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
      // WHO SYSTEM: when zustand rehydrates from localStorage on app load,
      // tell main about the restored user so audit attribution works
      // immediately (without waiting for next login).
      onRehydrateStorage: () => (state) => {
        if (state?.user?.id) syncUserToMain(state.user.id);
      },
    }
  )
);
