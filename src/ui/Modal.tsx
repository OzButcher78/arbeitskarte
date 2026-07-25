// ============================================================================
// Modal — one dialog shell for the whole app.
// ----------------------------------------------------------------------------
// Replaces five hand-rolled `fixed inset-0 bg-black/50 …` overlays that each got
// a different subset of the behaviour right: only one handled Escape, none had a
// focus trap, and the safe-area insets (Android edge-to-edge WebView) were
// re-derived per file. Z-order comes from the --z-* scale in src/index.css
// instead of ad-hoc z-30/60/65/70/200.
// ============================================================================

import React, { useCallback, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './Button';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Left of the title — an icon chip, usually. */
  leading?: React.ReactNode;
  /** Sticky footer. Omit for a dialog with no actions. */
  footer?: React.ReactNode;
  /** Tailwind max-width class for the panel. */
  size?: string;
  /** Nested dialogs (a picker on top of a dialog) sit one layer up. */
  nested?: boolean;
  /** Escape / backdrop return false to veto the close (unsaved-changes guard). */
  onRequestClose?: () => boolean | void;
  children: React.ReactNode;
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  leading,
  footer,
  size = 'max-w-xl',
  nested,
  onRequestClose,
  children,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const requestClose = useCallback(() => {
    if (onRequestClose && onRequestClose() === false) return;
    onClose();
  }, [onRequestClose, onClose]);

  // Escape to close + focus trap. Both are keydown-based, so one listener.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        requestClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    // Move focus into the dialog so the first Tab doesn't land behind it.
    const t = window.setTimeout(() => {
      const target = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      (target ?? panelRef.current)?.focus();
    }, 0);

    return () => {
      document.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
      restoreFocusRef.current?.focus?.();
    };
  }, [open, requestClose]);

  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center bg-black/50 px-4 ${
        nested ? 'z-[var(--z-modal-nested)]' : 'z-[var(--z-modal)]'
      }`}
      // Inset by the system-bar heights so the dialog and its footer stay clear
      // of the Android status/nav bar (edge-to-edge WebView).
      style={{
        paddingTop: 'calc(0.75rem + env(safe-area-inset-top))',
        paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={`flex max-h-full w-full ${size} flex-col overflow-hidden rounded-card bg-paper shadow-elev-pop outline-none`}
      >
        {(title || subtitle) && (
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              {leading}
              <div className="min-w-0">
                {title && <h3 className="truncate text-base font-semibold text-ink">{title}</h3>}
                {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
              </div>
            </div>
            <IconButton aria-label="Schliessen" onClick={requestClose}>
              <X size={20} />
            </IconButton>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>

        {footer && (
          <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
