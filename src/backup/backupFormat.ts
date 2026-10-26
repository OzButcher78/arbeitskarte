// ============================================================================
// backupFormat — serialize the whole Arbeitskarte DB to a single JSON envelope.
// ----------------------------------------------------------------------------
// Reads all three Dexie tables in one read-transaction snapshot and base64-encodes
// each blob's bytes (Ausweis + photos) sequentially to bound peak memory. The
// scanner API key is NOT included — it lives in the OS credential store, never in
// appmeta. The output is plaintext JSON (Halter PII + un-redacted Ausweis images),
// the same compliance surface as the DB itself.
// ============================================================================

import { db, type AppMetaRow } from '../storage/db';
import { blobToDataUrl } from '../utils/dataUrl';
import type { JobCardRecord, BlobRecord, GarageRecord } from '../types/jobcard';

/** A blob record with its bytes inlined as a base64 data: URL. */
export interface BackupBlob {
  id: string;
  jobcardId: string;
  sortOrder: number;
  kind: BlobRecord['kind'];
  mime: string;
  sha256?: string;
  createdAt: number;
  dataUrl: string;
}

export interface BackupEnvelope {
  app: 'arbeitskarte';
  /** db.verno at export time — restore warns when it differs (records bypass
   *  Dexie's .upgrade() migrations). */
  dbVersion: number;
  exportedAt: number;
  counts: { jobcards: number; blobs: number; appmeta: number; garagen?: number };
  jobcards: JobCardRecord[];
  appmeta: AppMetaRow[];
  blobs: BackupBlob[];
  /** Garagen-Adressbuch (db v3+). Absent in backups taken before it existed. */
  garagen?: GarageRecord[];
}

/** Snapshot the DB and return the serialized JSON string. `exportedAt` is passed
 *  in (from the caller's Date.now()) so the filename + envelope agree. */
export async function serializeBackup(exportedAt: number): Promise<string> {
  const snapshot = await db.transaction('r', db.jobcards, db.blobs, db.appmeta, db.garagen, async () => ({
    jobcards: await db.jobcards.toArray(),
    appmeta: await db.appmeta.toArray(),
    blobRecords: await db.blobs.toArray(),
    garagen: await db.garagen.toArray(),
  }));

  // Encode blob bytes sequentially (not Promise.all) to keep peak memory bounded.
  const blobs: BackupBlob[] = [];
  for (const b of snapshot.blobRecords) {
    const dataUrl = await blobToDataUrl(b.data);
    blobs.push({
      id: b.id,
      jobcardId: b.jobcardId,
      sortOrder: b.sortOrder,
      kind: b.kind,
      mime: b.mime,
      sha256: b.sha256,
      createdAt: b.createdAt,
      dataUrl,
    });
  }

  const envelope: BackupEnvelope = {
    app: 'arbeitskarte',
    dbVersion: db.verno,
    exportedAt,
    counts: {
      jobcards: snapshot.jobcards.length,
      blobs: blobs.length,
      appmeta: snapshot.appmeta.length,
      garagen: snapshot.garagen.length,
    },
    jobcards: snapshot.jobcards,
    appmeta: snapshot.appmeta,
    blobs,
    garagen: snapshot.garagen,
  };
  return JSON.stringify(envelope);
}

/** arbeitskarte-backup-YYYY-MM-DD_HHMM.json (local time). */
export function backupFileName(exportedAt: number): string {
  const d = new Date(exportedAt);
  const p = (n: number) => String(n).padStart(2, '0');
  return `arbeitskarte-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.json`;
}
