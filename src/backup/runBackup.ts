// ============================================================================
// runBackup — serialize → write → stamp lastBackupAt. Shared by the "Jetzt
// sichern" button and the launch auto-backup. maybeRunAutoBackup NEVER throws so
// a backup problem can't crash app start.
// ============================================================================

import type { AppSettings } from '../types/jobcard';
import { getMeta, setMeta } from '../storage/jobCardRepository';
import { isElectron, isAndroid } from '../platform/detect';
import { serializeBackup, backupFileName } from './backupFormat';
import { writeBackup, type WriteResult } from './backupTarget';

export const LAST_BACKUP_KEY = 'lastBackupAt';
const DAY_MS = 24 * 60 * 60 * 1000;

let inFlight: Promise<WriteResult> | null = null;

/** Run one backup now. Serialized via an in-flight guard so a double-click (or an
 *  auto-backup racing the button) can't produce two concurrent writes. */
export async function runBackup(settings: AppSettings): Promise<WriteResult> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const now = Date.now();
    const json = await serializeBackup(now);
    const result = await writeBackup(json, backupFileName(now), settings.backupDir);
    if (result.ok) await setMeta(LAST_BACKUP_KEY, now);
    return result;
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/** Fire-and-forget from the launch effect. Runs at most once per daily/weekly
 *  window; only on Electron (needs a configured folder) or Android (fixed folder)
 *  — a silent browser download on every launch would be intrusive. */
export async function maybeRunAutoBackup(settings: AppSettings): Promise<void> {
  try {
    if (!settings.backupEnabled) return;
    if (isElectron()) {
      if (!settings.backupDir) return;
    } else if (!isAndroid()) {
      return; // browser: manual backup only
    }
    const last = (await getMeta<number>(LAST_BACKUP_KEY)) ?? 0;
    const interval = settings.backupFrequency === 'daily' ? DAY_MS : 7 * DAY_MS;
    if (Date.now() - last < interval) return;
    await runBackup(settings);
  } catch (err) {
    // Launch must never crash on a backup problem.
    console.error('[backup] auto-backup failed:', err);
  }
}
