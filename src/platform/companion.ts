// ============================================================================
// LAN photo companion — renderer-side wrappers (Electron only).
// ----------------------------------------------------------------------------
// start() → { url } to render as a QR code; poll(token) → a data URL once the
// phone has uploaded a photo; stop() ends the pairing. On non-Electron runtimes
// the feature is simply unavailable (isCompanionAvailable() === false).
// ============================================================================

import { isElectron } from './detect';

export function isCompanionAvailable(): boolean {
  return isElectron() && !!window.electronAPI?.companion;
}

function bodyOf(result: { body: unknown }): Record<string, unknown> {
  const b = result.body;
  return b && typeof b === 'object' && !(b instanceof Uint8Array) ? (b as Record<string, unknown>) : {};
}

/** Start a pairing; returns the phone URL or an error code. */
export async function startCompanion(): Promise<{ url: string; token: string } | { error: string }> {
  const api = window.electronAPI?.companion;
  if (!api) return { error: 'unavailable' };
  try {
    const res = await api.start();
    const body = bodyOf(res);
    if (typeof body.url === 'string' && typeof body.token === 'string') {
      return { url: body.url, token: body.token };
    }
    return { error: typeof body.error === 'string' ? body.error : 'start_failed' };
  } catch {
    return { error: 'start_failed' };
  }
}

/** Poll once for an uploaded image; returns a data URL or null. */
export async function pollCompanion(token: string): Promise<string | null> {
  const api = window.electronAPI?.companion;
  if (!api) return null;
  try {
    const res = await api.poll(token);
    const body = bodyOf(res);
    return typeof body.image === 'string' ? body.image : null;
  } catch {
    return null;
  }
}

/** End the active pairing (best-effort). */
export async function stopCompanion(): Promise<void> {
  const api = window.electronAPI?.companion;
  if (!api) return;
  try {
    await api.stop();
  } catch {
    /* ignore */
  }
}
