// src/renderer/components/GlobalToolbar.tsx
//
// Top-right floating toolbar that hosts the global app affordances:
//   • Undo / Redo / History (P3.25)
//   • Recently-viewed dropdown (P3.32)
//
// Rendered once at app root (in index.tsx) so it's available
// across every module without each module having to wire it in.

import React from 'react';
import { useAuthStore } from '../stores/authStore';
import { UndoRedoButtons } from './UndoRedoButtons';
import { RecentlyViewedDropdown } from './RecentlyViewedDropdown';
import { useAppStore } from '../stores/appStore';

export const GlobalToolbar: React.FC = () => {
  const isAuthed = useAuthStore((s) => s.isAuthenticated);
  const setModule = useAppStore((s) => s.setModule);
  if (!isAuthed) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        right: 12,
        zIndex: 1000,
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        background: 'var(--color-bg-primary)',
        border: '1px solid var(--color-border-primary)',
        borderRadius: 8,
        padding: 4,
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
      }}
    >
      <UndoRedoButtons />
      <div style={{ width: 1, height: 20, background: 'var(--color-border-primary)' }} />
      <RecentlyViewedDropdown
        onNavigate={(item) => {
          // Map entity type → module name. Most pluralize.
          const moduleMap: Record<string, string> = {
            invoice: 'invoicing',
            client: 'clients',
            vendor: 'bills',
            expense: 'expenses',
            bill: 'bills',
            journal_entry: 'accounts',
            project: 'projects',
          };
          const target = moduleMap[item.type] || item.type;
          setModule(target as any);
          // Future enhancement: deep-link to the specific record
          // (the app currently routes to module list, not detail).
        }}
      />
    </div>
  );
};

export default GlobalToolbar;
