// src/renderer/components/RepeatLastAction.tsx
//
// A10 — Repeat last action.
//
// Power users hit ⌘. (Cmd+Period) to re-run the most recent action
// (typically a bulk operation) on the current selection. Useful
// after "applied tag X to 5 invoices" to apply the same tag to
// 5 more without redoing the menu navigation.
//
// Wires through undoStore.lastForwardOp — any module that wants to
// register a repeatable action calls setLastForwardOp() with a
// closure that re-runs the action.

import { useEffect } from 'react';
import { useUndoStore } from '../stores/undoStore';
import { useToast } from './ToastProvider';

function isInEditable(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}

export const RepeatLastAction: React.FC = () => {
  const replayLast = useUndoStore((s) => s.replayLast);
  const lastOp = useUndoStore((s) => s.lastForwardOp);
  const toast = useToast();

  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (isInEditable()) return;
      if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault();
        if (!lastOp) {
          toast.info('No previous action to repeat');
          return;
        }
        const r = await replayLast();
        if (r.ok) toast.success('Repeated: ' + lastOp.description);
        else if (r.error) toast.error(r.error);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lastOp, replayLast, toast]);

  return null; // behavior-only
};

export default RepeatLastAction;
