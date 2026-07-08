import { useEffect, useRef } from 'react';
import { isAndroid } from './detect';

/**
 * Route the Android hardware back button to `handler` while the calling
 * component is mounted (e.g. close a modal instead of exiting the app). No-op
 * on Electron / browser. Uses a ref so an inline handler doesn't re-subscribe
 * every render.
 */
export function useAndroidBackHandler(handler: () => void): void {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    if (!isAndroid()) return;
    let removed = false;
    let remove: (() => void) | undefined;
    void import('@capacitor/app')
      .then(({ App }) =>
        App.addListener('backButton', () => ref.current()).then((h) => {
          if (removed) { void h.remove(); return; }
          remove = () => { void h.remove(); };
        }),
      )
      .catch(() => {});
    return () => {
      removed = true;
      remove?.();
    };
  }, []);
}
