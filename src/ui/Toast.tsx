// ============================================================================
// Toast — transient feedback, bottom centre.
// ----------------------------------------------------------------------------
// The app previously said "done" with window.alert(), which blocks the WebView
// and needs a tap to dismiss — on a shop tablet that turns every print into two
// interactions. Toasts auto-dismiss and never block.
// ============================================================================

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

export type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  /** Optional single action, e.g. "Rückgängig". */
  action?: { label: string; onClick: () => void };
}

interface ToastApi {
  show: (message: string, kind?: ToastKind, action?: ToastItem['action']) => void;
  success: (message: string, action?: ToastItem['action']) => void;
  error: (message: string, action?: ToastItem['action']) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Errors stay up longer — they usually carry a provider message worth reading. */
const DURATION: Record<ToastKind, number> = { success: 3000, info: 3000, error: 6000 };

const STYLE: Record<ToastKind, string> = {
  success: 'border-ok/30 bg-ok-soft text-ok-strong',
  error: 'border-danger/30 bg-danger-soft text-danger-strong',
  info: 'border-line bg-paper text-ink',
};

const ICON: Record<ToastKind, React.ReactNode> = {
  success: <CheckCircle2 size={17} />,
  error: <AlertTriangle size={17} />,
  info: <Info size={17} />,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((i) => i.id !== id));
  }, []);

  const show = useCallback<ToastApi['show']>(
    (message, kind = 'info', action) => {
      const id = nextId.current++;
      setItems((list) => [...list, { id, kind, message, action }]);
      window.setTimeout(() => dismiss(id), DURATION[kind]);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (m, a) => show(m, 'success', a),
      error: (m, a) => show(m, 'error', a),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[var(--z-toast)] flex flex-col items-center gap-2 px-4"
        style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
        aria-live="polite"
        aria-atomic="false"
      >
        {items.map((item) => (
          <div
            key={item.id}
            className={`pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-card border px-4 py-3 text-sm shadow-elev-pop ${STYLE[item.kind]}`}
          >
            <span className="mt-0.5 shrink-0">{ICON[item.kind]}</span>
            <span className="min-w-0 flex-1 break-words">{item.message}</span>
            {item.action && (
              <button
                type="button"
                onClick={() => {
                  item.action?.onClick();
                  dismiss(item.id);
                }}
                className="shrink-0 rounded px-1.5 py-0.5 text-sm font-semibold underline underline-offset-2"
              >
                {item.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              aria-label="Meldung schliessen"
              className="shrink-0 opacity-60 hover:opacity-100"
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
