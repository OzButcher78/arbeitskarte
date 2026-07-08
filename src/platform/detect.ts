// ============================================================================
// PLATFORM DETECTION
// ----------------------------------------------------------------------------
// Three runtimes:
//   • 'browser'  — Vite dev build in a plain browser (fastest iteration)
//   • 'electron' — Windows desktop (electronAPI preload bridge)
//   • 'android'  — Capacitor wrapper around the same Vite bundle
// ============================================================================

export type Platform = 'browser' | 'electron' | 'android';

export function detectPlatform(): Platform {
  if (typeof window === 'undefined') return 'browser';
  const w = window;

  // Capacitor injects window.Capacitor in the Android WebView. Check the
  // native-platform predicate so a desktop browser with Capacitor (live-reload
  // dev) doesn't claim to be Android.
  const cap = w.Capacitor;
  if (
    cap &&
    typeof cap.isNativePlatform === 'function' &&
    cap.isNativePlatform() &&
    typeof cap.getPlatform === 'function' &&
    cap.getPlatform() === 'android'
  ) {
    return 'android';
  }

  if (typeof w.electronAPI !== 'undefined') {
    return 'electron';
  }
  return 'browser';
}

export function isElectron(): boolean {
  return detectPlatform() === 'electron';
}

export function isBrowser(): boolean {
  return detectPlatform() === 'browser';
}

export function isAndroid(): boolean {
  return detectPlatform() === 'android';
}
