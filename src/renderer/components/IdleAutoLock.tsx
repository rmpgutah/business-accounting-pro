// src/renderer/components/IdleAutoLock.tsx
//
// P5.57 — Idle session auto-lock
//
// After N minutes of no user input (mouse/keyboard/touch), logs the
// user out so a walked-away laptop doesn't leak financial data.
// Configurable via the `idle_lock_minutes` setting (per-company);
// 0 = disabled, default 30.
//
// Implementation:
//   • Listens for mousemove/keydown/click/scroll/touchstart on
//     document — any of these resets the idle timer.
//   • When timer fires, calls authStore.logout() which clears the
//     persisted session, returning the app to the login screen.
//   • Mounted at the app root once authenticated; unmounts on logout.

import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useToast } from './ToastProvider';
import api from '../lib/api';

const DEFAULT_IDLE_MINUTES = 30;
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const;

export const IdleAutoLock: React.FC = () => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const logout = useAuthStore((s) => s.logout);
  const toast = useToast();
  const [idleMinutes, setIdleMinutes] = useState<number>(DEFAULT_IDLE_MINUTES);

  // Read user-configured timeout from settings; cache for the session.
  useEffect(() => {
    if (!isAuthenticated) return;
    api.getSetting('idle_lock_minutes').then((v: any) => {
      const n = parseInt(String(v ?? ''), 10);
      if (Number.isFinite(n) && n >= 0 && n <= 1440) setIdleMinutes(n);
    }).catch(() => {});
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (idleMinutes <= 0) return; // 0 = disabled

    let timer: ReturnType<typeof setTimeout> | null = null;
    const reset = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          toast.warning('Session locked after ' + idleMinutes + ' min of inactivity. Please log in to continue.');
        } catch { /* toast may not be ready */ }
        logout();
      }, idleMinutes * 60 * 1000);
    };

    for (const ev of ACTIVITY_EVENTS) {
      document.addEventListener(ev, reset, { passive: true });
    }
    reset();

    return () => {
      if (timer) clearTimeout(timer);
      for (const ev of ACTIVITY_EVENTS) {
        document.removeEventListener(ev, reset);
      }
    };
  }, [isAuthenticated, idleMinutes, logout, toast]);

  return null; // No visible UI — this is a behavior-only component.
};

export default IdleAutoLock;
