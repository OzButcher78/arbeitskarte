// ============================================================================
// useAutosave — debounced persistence for an edited record.
// ----------------------------------------------------------------------------
// The editor used to hold the card in useState and write it only when the user
// pressed Speichern. "Zurück" and "Abbrechen" called onDone() with no dirty
// check, the Android hardware back button wasn't handled at all (back = app
// gone = draft gone), and meanwhile scan/photo/print each wrote to Dexie behind
// the button's back — so a card could also end up HALF saved.
//
// Design notes that are easy to get wrong:
//
//  • flush(next) takes an override. `setRecord(next); flush()` would persist the
//    PREVIOUS value, because the hook's ref is only updated on the next render.
//    Every caller that saves in the same tick as a state update must pass it.
//  • No save loop: saveJobCard() stamps updatedAt on a COPY and nothing flows
//    back into React state, so the value we watch never changes as a result of
//    saving. Do not "fix" that by syncing updatedAt back — that is the loop.
//  • Dirty tracking is a serialized snapshot, not deep equality. It is also what
//    makes React StrictMode's double-mount a no-op instead of persisting a
//    pristine draft in dev.
//  • The unload handlers are best effort: an async IndexedDB transaction cannot
//    be awaited during unload. That is an argument for a SHORT debounce, not for
//    skipping them.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { isAndroid } from '../platform/detect';

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'error';

export interface Autosave<T> {
  /** Persist now, cancelling any pending debounce. Pass `next` when calling in
   *  the same tick as the state update that produced it. */
  flush: (next?: T) => Promise<void>;
  /** Drop the pending write without saving (used before deleting the record —
   *  Dexie `put` is an upsert and would otherwise resurrect the deleted row). */
  cancel: () => void;
  status: AutosaveStatus;
}

export function useAutosave<T>(
  value: T | null,
  save: (value: T) => Promise<void>,
  opts?: { delay?: number; enabled?: boolean },
): Autosave<T> {
  const delay = opts?.delay ?? 700;
  const enabled = opts?.enabled ?? true;

  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const valueRef = useRef<T | null>(value);
  const saveRef = useRef(save);
  const lastSavedRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  /** Serialised writes — a flush during an in-flight save queues behind it. */
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  valueRef.current = value;
  saveRef.current = save;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    clearTimer();
    setStatus('idle');
  }, [clearTimer]);

  const flush = useCallback(
    (next?: T): Promise<void> => {
      clearTimer();
      const v = next ?? valueRef.current;
      if (v == null) return Promise.resolve();
      const serialized = JSON.stringify(v);
      if (serialized === lastSavedRef.current) return chainRef.current;

      lastSavedRef.current = serialized;
      setStatus('saving');
      chainRef.current = chainRef.current
        .catch(() => {})
        .then(() => saveRef.current(v))
        .then(
          () => {
            setStatus('idle');
          },
          (err) => {
            // Forget the snapshot so the next change retries rather than
            // assuming the write landed.
            lastSavedRef.current = null;
            setStatus('error');
            console.warn('[autosave] save failed:', err);
          },
        );
      return chainRef.current;
    },
    [clearTimer],
  );

  // Adopt the first value as the baseline: loading a card must not immediately
  // rewrite it (and, for a brand-new draft, must not persist it before the user
  // has typed anything).
  useEffect(() => {
    if (value != null && lastSavedRef.current === null) {
      lastSavedRef.current = JSON.stringify(value);
    }
  }, [value]);

  // Debounced write on change.
  useEffect(() => {
    if (!enabled || value == null) return;
    if (JSON.stringify(value) === lastSavedRef.current) return;
    setStatus('pending');
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void flush();
    }, delay);
    return clearTimer;
  }, [value, enabled, delay, flush, clearTimer]);

  // Last-chance writes. Android never fires `pagehide` when the app is
  // backgrounded, hence the Capacitor App 'pause' listener alongside it.
  useEffect(() => {
    if (!enabled) return;
    const save = () => {
      if (valueRef.current == null) return;
      if (JSON.stringify(valueRef.current) === lastSavedRef.current) return;
      void flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') save();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', save);

    let removePause: (() => void) | undefined;
    if (isAndroid()) {
      void import('@capacitor/app')
        .then(({ App }) => App.addListener('pause', save))
        .then((h) => { removePause = () => { void h.remove(); }; })
        .catch(() => {});
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', save);
      removePause?.();
      save(); // unmount — guarded by the dirty check, so StrictMode is a no-op
    };
  }, [enabled, flush]);

  return { flush, cancel, status };
}
