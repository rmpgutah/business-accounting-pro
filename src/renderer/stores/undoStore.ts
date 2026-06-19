// src/renderer/stores/undoStore.ts
//
// P3.25 Phase 1+2 — Undo/Redo store
//
// Mutation log + reverse-operation approach. Pushed onto by every
// mutating IPC call wrapped through `recordedMutation()` (see
// lib/recordedMutation.ts). Topbar Undo/Redo buttons + ⌘Z trigger
// pop-and-replay.
//
// See docs/undo-redo-design.md for the architecture.

import { create } from 'zustand';
import api from '../lib/api';

export interface UndoEntry {
  id: string;
  entity_type: string;       // 'invoices' | 'bills' | 'expenses' | etc.
  entity_id: string;
  operation: 'create' | 'update' | 'delete' | 'soft_delete' | 'bulk_update' | 'bulk_delete';
  // Inverse: what to call to undo this action.
  // For 'update': patch the row back to old values.
  // For 'create': delete the row.
  // For 'delete' / 'soft_delete': restore (use trash:restore for soft).
  // For 'bulk_*': apply per-id patches.
  inverse: {
    op: 'patch' | 'delete' | 'restore' | 'bulk_patch';
    payload: any;             // shape depends on op
  };
  // Forward: what to do to redo this action after it's been undone.
  forward: {
    op: 'patch' | 'delete' | 'restore' | 'bulk_patch';
    payload: any;
  };
  summary: string;            // "Invoice INV-…0042: total 100 → 150"
  performed_at: number;       // ms epoch
}

interface UndoStoreState {
  past: UndoEntry[];          // most recent at end (push/pop)
  future: UndoEntry[];        // populated on undo, drained on redo
  maxDepth: number;
  busy: boolean;              // true while applying an undo/redo
  // Last action — used by P3.A10 "Repeat last action" (⌘.)
  lastForwardOp: { entity_type: string; description: string; replay: () => Promise<void> } | null;

  push: (entry: UndoEntry) => void;
  undo: () => Promise<{ ok: boolean; error?: string; summary?: string }>;
  redo: () => Promise<{ ok: boolean; error?: string; summary?: string }>;
  clear: () => void;
  setLastForwardOp: (op: UndoStoreState['lastForwardOp']) => void;
  replayLast: () => Promise<{ ok: boolean; error?: string }>;
}

const MAX_DEPTH_DEFAULT = 50;

export const useUndoStore = create<UndoStoreState>((set, get) => ({
  past: [],
  future: [],
  maxDepth: MAX_DEPTH_DEFAULT,
  busy: false,
  lastForwardOp: null,

  push: (entry) => {
    set((state) => {
      // Clear `future` when a NEW action is pushed — the user has
      // diverged from the redo path.
      const past = [...state.past, entry];
      // Cap to maxDepth (FIFO eviction).
      const trimmed = past.length > state.maxDepth ? past.slice(past.length - state.maxDepth) : past;
      return { past: trimmed, future: [] };
    });
  },

  undo: async () => {
    const state = get();
    if (state.busy) return { ok: false, error: 'busy' };
    const top = state.past[state.past.length - 1];
    if (!top) return { ok: false, error: 'Nothing to undo' };

    set({ busy: true });
    try {
      const r = await applyOperation(top.inverse, top.entity_type, top.entity_id);
      if (!r.ok) return { ok: false, error: r.error };
      set((s) => ({
        past: s.past.slice(0, -1),
        future: [...s.future, top],
      }));
      return { ok: true, summary: top.summary };
    } finally {
      set({ busy: false });
    }
  },

  redo: async () => {
    const state = get();
    if (state.busy) return { ok: false, error: 'busy' };
    const top = state.future[state.future.length - 1];
    if (!top) return { ok: false, error: 'Nothing to redo' };

    set({ busy: true });
    try {
      const r = await applyOperation(top.forward, top.entity_type, top.entity_id);
      if (!r.ok) return { ok: false, error: r.error };
      set((s) => ({
        past: [...s.past, top],
        future: s.future.slice(0, -1),
      }));
      return { ok: true, summary: top.summary };
    } finally {
      set({ busy: false });
    }
  },

  clear: () => set({ past: [], future: [] }),

  setLastForwardOp: (op) => set({ lastForwardOp: op }),

  replayLast: async () => {
    const last = get().lastForwardOp;
    if (!last) return { ok: false, error: 'No previous action to repeat' };
    try {
      await last.replay();
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Replay failed' };
    }
  },
}));

// ── Operation dispatcher ──────────────────────────────────────
// Maps the abstract { op, payload } shape to concrete IPC calls.
// All paths are idempotent in the "apply twice → same result" sense
// (within the same session) — the store enforces stack ordering so
// idempotency only matters under conflict.
async function applyOperation(
  spec: UndoEntry['inverse'],
  entity_type: string,
  entity_id: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    switch (spec.op) {
      case 'patch':
        await api.update(entity_type, entity_id, spec.payload);
        return { ok: true };
      case 'delete':
        await api.remove(entity_type, entity_id);
        return { ok: true };
      case 'restore':
        // Soft-delete restore goes through trash:restore.
        const r = await api.trashRestore(entity_type, entity_id);
        return { ok: !r.error, error: r.error };
      case 'bulk_patch':
        // payload: Array<{ id: string; patch: object }>
        const patches = spec.payload as Array<{ id: string; patch: any }>;
        for (const p of patches) {
          await api.update(entity_type, p.id, p.patch);
        }
        return { ok: true };
      default:
        return { ok: false, error: `Unknown op: ${(spec as any).op}` };
    }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Operation failed' };
  }
}

// Helper: build a human-readable summary from a field-level diff.
// Used by the recordedMutation wrapper.
export function summarizeDiff(
  entity_type: string,
  entity_id: string,
  diff: Record<string, { old: any; new: any }>,
): string {
  const fields = Object.entries(diff).slice(0, 3).map(([k, v]) => {
    const fmt = (x: any) => x == null ? '∅' : String(x).slice(0, 20);
    return `${k}: ${fmt(v.old)} → ${fmt(v.new)}`;
  }).join(' · ');
  const more = Object.keys(diff).length > 3 ? ` (+${Object.keys(diff).length - 3} more)` : '';
  return `${entity_type} ${entity_id.slice(0, 8)}: ${fields}${more}`;
}
