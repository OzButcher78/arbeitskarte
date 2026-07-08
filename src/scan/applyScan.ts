// ============================================================================
// applyScan — map a confirmed ScanResult onto a JobCardRecord (vehicle + Halter).
// Only non-empty scan values are written, so a scan never blanks a field the
// user already filled.
// ============================================================================

import type { ScanResult } from './documentScanner';
import type { JobCardRecord } from '../types/jobcard';

function has(v: string | null | undefined): v is string {
  return v != null && String(v).trim() !== '';
}

export function applyScanToRecord(record: JobCardRecord, scan: ScanResult): JobCardRecord {
  const patch: Partial<JobCardRecord> = {};

  // Fahrzeug
  if (has(scan.make)) patch.fahrzeugmarke = scan.make;
  if (has(scan.model)) patch.fahrzeugtyp = scan.model;
  if (has(scan.licensePlate)) patch.kontrollschild = scan.licensePlate.toUpperCase();
  if (has(scan.chassisNr)) patch.vin = scan.chassisNr.toUpperCase();
  if (has(scan.stammnummer)) patch.stammnummer = scan.stammnummer.toUpperCase();
  if (has(scan.color)) patch.farbe = scan.color;
  if (has(scan.erstzulassung)) patch.erstzulassung = scan.erstzulassung;
  if (has(scan.insurance)) patch.versicherung = scan.insurance;

  // Halter → Kunde
  if (has(scan.halterVorname)) patch.vorname = scan.halterVorname;
  if (has(scan.halterName)) patch.name = scan.halterName;
  if (has(scan.halterStrasse)) patch.strasse = scan.halterStrasse;
  const plzOrt = [scan.halterPlz, scan.halterOrt].filter((s) => has(s)).join(' ').trim();
  if (plzOrt) patch.plzOrt = plzOrt;

  return { ...record, ...patch };
}
