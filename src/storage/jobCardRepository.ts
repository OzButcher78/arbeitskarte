// ============================================================================
// jobCardRepository — the only module that talks to Dexie for job cards,
// blobs, and settings. Mirrors the source app's repository *pattern* (own schema).
// ============================================================================

import { db, type AppMetaRow } from './db';
import type { JobCardRecord, BlobRecord, AppSettings } from '../types/jobcard';
import { DEFAULT_SETTINGS } from '../types/jobcard';
import { formatJobNumber, parseJobNumber } from '../numbering/jobNumber';

const SETTINGS_KEY = 'settings';

export function newId(): string {
  return crypto.randomUUID();
}

// ── Job cards ───────────────────────────────────────────────────────────────

export async function saveJobCard(record: JobCardRecord): Promise<void> {
  await db.jobcards.put({ ...record, updatedAt: Date.now() });
}

export async function getJobCard(id: string): Promise<JobCardRecord | undefined> {
  return db.jobcards.get(id);
}

/** Hard-delete a card and all its blobs in one transaction. */
export async function deleteJobCard(id: string): Promise<void> {
  await db.transaction('rw', db.jobcards, db.blobs, async () => {
    await db.blobs.where('jobcardId').equals(id).delete();
    await db.jobcards.delete(id);
  });
}

export interface JobCardListFilter {
  /** Free text matched across jobNumber / kontrollschild / vin / name / garageName. */
  query?: string;
  status?: JobCardRecord['status'];
}

export async function loadJobCardsList(filter?: JobCardListFilter): Promise<JobCardRecord[]> {
  let rows = await db.jobcards.toArray();

  if (filter?.status) {
    rows = rows.filter((r) => r.status === filter.status);
  }

  const q = filter?.query?.trim().toLowerCase();
  if (q) {
    rows = rows.filter((r) => {
      const hay = [r.jobNumber, r.kontrollschild, r.vin, r.name, r.garageName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }

  // Newest change first.
  rows.sort((a, b) => b.updatedAt - a.updatedAt);
  return rows;
}

/** Highest numeric suffix currently stored for the given prefix (0 if none). */
export async function getMaxJobNumber(prefix: string): Promise<number> {
  const rows = await db.jobcards.toArray();
  let max = 0;
  for (const r of rows) {
    const n = parseJobNumber(prefix, r.jobNumber);
    if (n != null && n > max) max = n;
  }
  return max;
}

/**
 * Mint the next auto job number and advance the stored counter. Safety:
 * max(jobNextNumber, dbMax + 1) so a gap or an imported higher number can
 * never be re-issued.
 */
export async function mintJobNumber(): Promise<string> {
  const settings = await getSettings();
  const dbMax = await getMaxJobNumber(settings.jobPrefix);
  const n = Math.max(settings.jobNextNumber, dbMax + 1);
  const jobNumber = formatJobNumber(settings.jobPrefix, n);
  await saveSettings({ ...settings, jobNextNumber: n + 1 });
  return jobNumber;
}

// ── Blobs (Ausweis + photos) ─────────────────────────────────────────────────

export async function saveBlob(blob: BlobRecord): Promise<void> {
  await db.blobs.put(blob);
}

export async function getBlob(id: string): Promise<BlobRecord | undefined> {
  return db.blobs.get(id);
}

export async function getBlobs(jobcardId: string): Promise<BlobRecord[]> {
  const rows = await db.blobs.where('jobcardId').equals(jobcardId).toArray();
  rows.sort((a, b) => a.sortOrder - b.sortOrder);
  return rows;
}

export async function deleteBlob(id: string): Promise<void> {
  await db.blobs.delete(id);
}

// ── Settings / counters (appmeta) ─────────────────────────────────────────────

export async function getSettings(): Promise<AppSettings> {
  const row = await db.appmeta.get(SETTINGS_KEY);
  if (!row) return { ...DEFAULT_SETTINGS };
  // Shallow-merge over defaults so new fields added in later versions are
  // always present (backwards compatibility).
  const stored = row.value as Partial<AppSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    workshop: { ...DEFAULT_SETTINGS.workshop, ...(stored.workshop ?? {}) },
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const row: AppMetaRow = { key: SETTINGS_KEY, value: settings };
  await db.appmeta.put(row);
}

// ── Generic appmeta ───────────────────────────────────────────────────────────

export async function getMeta<T = unknown>(key: string): Promise<T | undefined> {
  const row = await db.appmeta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.appmeta.put({ key, value });
}
