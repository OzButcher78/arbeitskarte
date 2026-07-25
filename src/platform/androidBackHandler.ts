import { useEffect, useRef } from 'react';
import { isAndroid } from './detect';

/**
 * Route the Android hardware back button to `handler` while the calling
 * component is mounted (e.g. close a modal instead of exiting the app). No-op
 * on Electron / browser.
 *
 * Handlers form a LIFO stack behind ONE native listener, because Capacitor's
 * `backButton` event is a broadcast: `AppPlugin.handleOnBackPressed()` calls
 * `notifyListeners()`, which fires EVERY registered JS listener. With one
 * listener per component, a back press while a dialog sits on top of the editor
 * would close the dialog AND leave the editor — losing the user's place. Only
 * the top of the stack runs.
 *
 * The native listener itself is registered lazily and removed once the stack is
 * empty, so screens with no handler keep the platform default (on the list view,
 * back still exits the app as it always did).
 *
 * `enabled` is not optional in practice: components that render unconditionally
 * and bail out with `return null` (DocumentScanModal) still run their hooks, so
 * they would otherwise sit permanently on top of the stack while closed.
 */

type Handler = () => void;

const stack: { fn: Handler }[] = [];
let detach: (() => void) | null = null;
let attaching = false;

function dispatch(): void {
  const top = stack[stack.length - 1];
  top?.fn();
}

function attachIfNeeded(): void {
  if (detach || attaching || stack.length === 0) return;
  attaching = true;
  void import('@capacitor/app')
    .then(({ App }) => App.addListener('backButton', dispatch))
    .then((h) => {
      attaching = false;
      // The last handler may have unmounted while the import was in flight.
      if (stack.length === 0) {
        void h.remove();
        return;
      }
      detach = () => { void h.remove(); };
    })
    .catch(() => { attaching = false; });
}

function detachIfEmpty(): void {
  if (stack.length > 0 || !detach) return;
  detach();
  detach = null;
}

export function useAndroidBackHandler(handler: Handler, enabled = true): void {
  // A ref entry keeps the stack slot stable while the closure changes each
  // render, so an inline handler doesn't re-order the stack.
  const entry = useRef<{ fn: Handler }>({ fn: handler });
  entry.current.fn = handler;

  useEffect(() => {
    if (!isAndroid() || !enabled) return;
    const slot = entry.current;
    stack.push(slot);
    attachIfNeeded();
    return () => {
      const i = stack.lastIndexOf(slot);
      if (i >= 0) stack.splice(i, 1);
      detachIfEmpty();
    };
  }, [enabled]);
}
