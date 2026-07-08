// ============================================================================
// Dexie database — the Arbeitskarte archive (single device, IndexedDB).
// Schema owned here (§5.5). Audit chain / vault sync deliberately absent.
// ============================================================================

import Dexie, { type Table } from 'dexie';
import type { JobCardRecord, BlobRecord } from '../types/jobcard';

export interface AppMetaRow {
  key: string;
  value: unknown;
}

export class ArbeitskarteDB extends Dexie {
  jobcards!: Table<JobCardRecord, string>;
  blobs!: Table<BlobRecord, string>;
  appmeta!: Table<AppMetaRow, string>;

  constructor() {
    super('Arbeitskarte_DB');
    this.version(1).stores({
      jobcards: 'id, jobNumber, kontrollschild, vin, name, status, createdAt, updatedAt',
      blobs: 'id, jobcardId, sortOrder',
      appmeta: 'key',
    });
  }
}

export const db = new ArbeitskarteDB();
