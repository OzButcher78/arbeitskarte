// ============================================================================
// restoreBackup — validate a backup envelope and write it back into Dexie.
// ----------------------------------------------------------------------------
// Only jobcards + blobs are restored (bulkPut). appmeta is intentionally NOT
// restored so the current settings + job-number counter on this device are kept.
// Records bypass Dexie's .upgrade() migrations, so the caller should warn when the
// backup's dbVersion differs from db.verno (see hasVersionMismatch).
// ============================================================================

import { db } from '../storage/db';
import { dataUrlToBlob } from '../utils/dataUrl';
import type { BlobRecord } from '../types/jobcard';
import type { BackupEnvelope } from './backupFormat';

export type RestoreMode = 'merge' | 'replace';

export interface RestoreResult {
  ok: boolean;
  jobcards: number;
  blobs: number;
  error?: string;
}

/** Parse + shape-validate a backup file's text. Returns null if it isn't one. */
export function parseBackup(text: string): BackupEnvelope | null {
  try {
    const obj = JSON.parse(text) as Partial<BackupEnvelope>;
    if (
      obj &&
      obj.app === 'arbeitskarte' &&
      Array.isArray(obj.jobcards) &&
      Array.isArray(obj.blobs) &&
      Array.isArray(obj.appmeta)
    ) {
      return obj as BackupEnvelope;
    }
    return null;
  } catch {
    return null;
  }
}

/** True when the backup was taken under a different Dexie schema version. */
export function hasVersionMismatch(envelope: BackupEnvelope): boolean {
  return envelope.dbVersion !== db.verno;
}

export async function restoreBackup(envelope: BackupEnvelope, mode: RestoreMode): Promise<RestoreResult> {
  try {
    // Rehydrate blob bytes from their data: URLs first (async, outside the tx).
    const blobRecords: BlobRecord[] = [];
    for (const b of envelope.blobs) {
      const data = await dataUrlToBlob(b.dataUrl);
      blobRecords.push({
        id: b.id,
        jobcardId: b.jobcardId,
        sortOrder: b.sortOrder,
        kind: b.kind,
        mime: b.mime,
        data,
        sha256: b.sha256,
        createdAt: b.createdAt,
      });
    }

    await db.transaction('rw', db.jobcards, db.blobs, async () => {
      if (mode === 'replace') {
        await db.jobcards.clear();
        await db.blobs.clear();
      }
      await db.jobcards.bulkPut(envelope.jobcards);
      await db.blobs.bulkPut(blobRecords);
    });

    return { ok: true, jobcards: envelope.jobcards.length, blobs: blobRecords.length };
  } catch (e) {
    return { ok: false, jobcards: 0, blobs: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
