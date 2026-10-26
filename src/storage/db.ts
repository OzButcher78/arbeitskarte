// ============================================================================
// Dexie database — the Arbeitskarte archive (single device, IndexedDB).
// Schema owned here (§5.5). Audit chain / vault sync deliberately absent.
// ============================================================================

import Dexie, { type Table } from 'dexie';
import type { JobCardRecord, BlobRecord, GarageRecord } from '../types/jobcard';
import { LEGACY_PANEL_MIGRATION } from '../carmap/panels';

export interface AppMetaRow {
  key: string;
  value: unknown;
}

export class ArbeitskarteDB extends Dexie {
  jobcards!: Table<JobCardRecord, string>;
  blobs!: Table<BlobRecord, string>;
  appmeta!: Table<AppMetaRow, string>;
  garagen!: Table<GarageRecord, string>;

  constructor() {
    super('Arbeitskarte_DB');
    this.version(1).stores({
      jobcards: 'id, jobNumber, kontrollschild, vin, name, status, createdAt, updatedAt',
      blobs: 'id, jobcardId, sortOrder',
      appmeta: 'key',
    });
    // v2: FlatCarMap2 blueprint. Remap old region ids → new data-panel keys
    // (unknown/legacy-only ids like schwellerL/R kept verbatim) and backfill
    // the new damageStrokes field. Same three stores; atomic upgrade tx.
    this.version(2)
      .stores({
        jobcards: 'id, jobNumber, kontrollschild, vin, name, status, createdAt, updatedAt',
        blobs: 'id, jobcardId, sortOrder',
        appmeta: 'key',
      })
      .upgrade((tx) =>
        tx
          .table('jobcards')
          .toCollection()
          .modify((jc: JobCardRecord) => {
            if (Array.isArray(jc.damagedParts)) {
              const seen = new Set<string>();
              const remapped: string[] = [];
              for (const id of jc.damagedParts) {
                const key = LEGACY_PANEL_MIGRATION[id] ?? id;
                if (!seen.has(key)) {
                  seen.add(key);
                  remapped.push(key);
                }
              }
              jc.damagedParts = remapped;
            }
            if (!Array.isArray(jc.damageStrokes)) jc.damageStrokes = [];
          }),
      );
    // v3: Garagen-Adressbuch. New store only; job cards carry the garage as a
    // snapshot (garageName/…), so no record migration is needed.
    this.version(3).stores({
      jobcards: 'id, jobNumber, kontrollschild, vin, name, status, createdAt, updatedAt',
      blobs: 'id, jobcardId, sortOrder',
      appmeta: 'key',
      garagen: 'id, name, updatedAt',
    });
  }
}

export const db = new ArbeitskarteDB();
