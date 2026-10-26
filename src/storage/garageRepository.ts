// ============================================================================
// garageRepository — the Garagen-Adressbuch (Dexie `garagen` store, v3).
// ----------------------------------------------------------------------------
// Garages that regularly deliver vehicles to the shop. A job card does NOT
// reference these by id alone: picking a garage copies name/address onto the
// card (see JobCardRecord.garage*), so editing or deleting an entry here never
// changes a card that was already printed.
// ============================================================================

import { db } from './db';
import type { GarageRecord } from '../types/jobcard';
import { newId } from './jobCardRepository';

/** Collator for the list order — Swiss-German, case-insensitive. */
const byName = new Intl.Collator('de-CH', { sensitivity: 'base' });

export async function loadGaragen(): Promise<GarageRecord[]> {
  const rows = await db.garagen.toArray();
  rows.sort((a, b) => byName.compare(a.name, b.name));
  return rows;
}

/** Insert or update. Trims every field; an empty name is rejected by the caller. */
export async function saveGarage(input: Omit<GarageRecord, 'createdAt' | 'updatedAt'> & { createdAt?: number }): Promise<GarageRecord> {
  const now = Date.now();
  const existing = await db.garagen.get(input.id);
  const rec: GarageRecord = {
    id: input.id,
    name: input.name.trim(),
    strasse: input.strasse?.trim() || undefined,
    plzOrt: input.plzOrt?.trim() || undefined,
    telefon: input.telefon?.trim() || undefined,
    email: input.email?.trim() || undefined,
    createdAt: existing?.createdAt ?? input.createdAt ?? now,
    updatedAt: now,
  };
  await db.garagen.put(rec);
  return rec;
}

export async function deleteGarage(id: string): Promise<void> {
  await db.garagen.delete(id);
}

/** A blank entry ready for the edit form. */
export function newGarage(seed?: Partial<GarageRecord>): GarageRecord {
  const now = Date.now();
  return { id: newId(), name: '', strasse: '', plzOrt: '', telefon: '', email: '', ...seed, createdAt: now, updatedAt: now };
}
