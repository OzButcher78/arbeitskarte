// ============================================================================
// Open the OS app-settings screen (Android only).
// ----------------------------------------------------------------------------
// Backed by the tiny native AppSettingsPlugin. Used to help the user grant the
// camera permission after a permanent denial, when Android no longer re-prompts.
// No-op on Electron / browser.
// ============================================================================

import { registerPlugin } from '@capacitor/core';
import { isAndroid } from './detect';

interface AppSettingsPlugin {
  openAppSettings(): Promise<void>;
}

const AppSettings = registerPlugin<AppSettingsPlugin>('AppSettings');

/** True where the deep-link to system settings is available. */
export function canOpenAppSettings(): boolean {
  return isAndroid();
}

/** Open this app's system settings page (App info › Permissions). */
export async function openAppSettings(): Promise<void> {
  if (!isAndroid()) return;
  try {
    await AppSettings.openAppSettings();
  } catch (err) {
    console.warn('[appSettings] openAppSettings failed:', err);
  }
}
