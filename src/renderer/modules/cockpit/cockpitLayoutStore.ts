import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import api from '../../lib/api';
import { WidgetPlacement, addWidget as addW, removeWidget as removeW, updatePlacement as updateP } from './layout-utils';

const DEFAULT_LAYOUT: WidgetPlacement[] = [
  { id: 'w-kpis', type: 'kpis', x: 0, y: 0, w: 12, h: 2 },
  { id: 'w-cash', type: 'cash-forecast', x: 0, y: 2, w: 6, h: 3 },
  { id: 'w-anom', type: 'anomalies', x: 6, y: 2, w: 6, h: 3 },
  { id: 'w-ar', type: 'ar-aging', x: 0, y: 5, w: 6, h: 3 },
  { id: 'w-top', type: 'top-clients', x: 6, y: 5, w: 6, h: 3 },
];

interface CockpitState {
  layout: WidgetPlacement[];
  editing: boolean;
  setEditing: (v: boolean) => void;
  setLayout: (l: WidgetPlacement[]) => void;
  addWidget: (type: string) => void;
  removeWidget: (id: string) => void;
  updatePlacement: (id: string, patch: Partial<WidgetPlacement>) => void;
  resetLayout: () => void;
  loadFromCloud: (userId: string, companyId: string) => Promise<void>;
  saveToCloud: (userId: string, companyId: string) => Promise<void>;
}

const cloudKey = (u: string, c: string) => `cockpit-layout:${u}:${c}`;

export const useCockpitLayoutStore = create<CockpitState>()(
  persist(
    (set, get) => ({
      layout: DEFAULT_LAYOUT,
      editing: false,
      setEditing: (v) => set({ editing: v }),
      setLayout: (l) => set({ layout: l }),
      addWidget: (type) => set({ layout: addW(get().layout, type, `w-${type}-${crypto.randomUUID()}`) }),
      removeWidget: (id) => set({ layout: removeW(get().layout, id) }),
      updatePlacement: (id, patch) => set({ layout: updateP(get().layout, id, patch) }),
      resetLayout: () => set({ layout: DEFAULT_LAYOUT }),
      loadFromCloud: async (userId, companyId) => {
        try {
          const raw = await api.getSetting(cloudKey(userId, companyId));
          if (!raw) return;
          const data = JSON.parse(raw);
          if (Array.isArray(data?.layout)) set({ layout: data.layout });
        } catch { /* keep current/default */ }
      },
      saveToCloud: async (userId, companyId) => {
        try { await api.setSetting(cloudKey(userId, companyId), JSON.stringify({ layout: get().layout })); }
        catch { /* best effort */ }
      },
    }),
    { name: 'bap-cockpit-layout', partialize: (s) => ({ layout: s.layout }) }
  )
);
