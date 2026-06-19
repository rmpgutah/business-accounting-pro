// src/renderer/lib/use-modal-behavior.ts
// A11Y: Centralized modal behavior — ESC to close, body scroll lock,
// focus first input on open, restore focus on close.
import { useEffect, useRef } from 'react';

interface Options {
  isOpen?: boolean;
  onClose: () => void;
  // Allow callers to skip ESC handling (e.g. when nested modals manage their own).
  closeOnEscape?: boolean;
  // Lock body scroll while open.
  lockScroll?: boolean;
}

/**
 * useModalBehavior wires the standard a11y behavior for a modal:
 *  - listens for Escape to call onClose
 *  - locks body scroll while mounted/open
 *  - returns a containerRef + a way to set initial focus
 *  - restores focus to the previously focused element on unmount
 */
export function useModalBehavior({ isOpen = true, onClose, closeOnEscape = true, lockScroll = true }: Options) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    // Focus first focusable element inside the modal.
    const t = window.setTimeout(() => {
      const node = containerRef.current;
      if (!node) return;
      const focusable = node.querySelector<HTMLElement>(
        'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable) focusable.focus();
      else node.focus();
    }, 0);

    return () => {
      window.clearTimeout(t);
      // A11Y: Restore focus on close
      const prev = previouslyFocused.current;
      if (prev && typeof prev.focus === 'function') {
        try { prev.focus(); } catch { /* element gone */ }
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, closeOnEscape, onClose]);

  useEffect(() => {
    if (!isOpen || !lockScroll) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen, lockScroll]);

  return { containerRef };
}

/**
 * Trap Tab focus inside the given container. Wire by attaching
 * onKeyDown={trapFocusOnKeyDown(containerRef)} to the modal container.
 */
// A11Y: accept the actual ref shape useModalBehavior produces — a nullable
// HTMLElement (HTMLDivElement | null is the common caller shape). Strict
// typecheck flagged consumers passing useRef<HTMLDivElement>(null) against
// the prior non-null signature.
export function trapFocusOnKeyDown(containerRef: React.RefObject<HTMLElement | null>) {
  return (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const node = containerRef.current;
    if (!node) return;
    const focusable = Array.from(
      node.querySelectorAll<HTMLElement>(
        'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      )
    ).filter(el => !el.hasAttribute('aria-hidden'));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (active === first || !node.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
}
