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

/** Swiss / EU legal-entity markers. When the Fahrzeugausweis lists a business as
 *  the Halter (e.g. trailers registered to a "… AG" / "… GmbH"), the model reads
 *  it into halterName; that belongs in the Firma field, not the personal name. */
const COMPANY_RE =
  /(?:\bAG\b|\bGmbH\b|\bSA\b|\bS[àa]rl\b|\bSAGL\b|\bK(?:l)?G\b|&\s?Co\b|\bLtd\b|Genossenschaft|Stiftung|Treuhand)/i;

/** True when a Halter name looks like a company rather than a person. Only
 *  consulted when there is no first name (companies have none). */
function looksLikeCompany(name: string): boolean {
  return COMPANY_RE.test(name);
}

export function applyScanToRecord(record: JobCardRecord, scan: ScanResult): JobCardRecord {
  const patch: Partial<JobCardRecord> = {};

  // Fahrzeug
  if (has(scan.make)) patch.fahrzeugmarke = scan.make;
  if (has(scan.model)) patch.fahrzeugtyp = scan.model;
  if (has(scan.licensePlate)) patch.kontrollschild = scan.licensePlate.toUpperCase();
  if (has(scan.chassisNr)) patch.vin = scan.chassisNr.toUpperCase();
  if (has(scan.stammnummer)) patch.stammnummer = scan.stammnummer.toUpperCase();
  if (has(scan.typengenehmigung)) patch.typengenehmigung = scan.typengenehmigung.toUpperCase();
  if (has(scan.color)) patch.farbe = scan.color;
  if (has(scan.erstzulassung)) patch.erstzulassung = scan.erstzulassung;
  if (has(scan.insurance)) patch.versicherung = scan.insurance;

  // Halter → Kunde. A business keeper (…AG, GmbH, SA, Sàrl…) with no first name
  // goes into Firma; otherwise it is a person → Vorname / Name.
  if (has(scan.halterName) && !has(scan.halterVorname) && looksLikeCompany(scan.halterName)) {
    patch.firma = scan.halterName;
  } else {
    if (has(scan.halterVorname)) patch.vorname = scan.halterVorname;
    if (has(scan.halterName)) patch.name = scan.halterName;
  }
  if (has(scan.halterStrasse)) patch.strasse = scan.halterStrasse;
  const plzOrt = [scan.halterPlz, scan.halterOrt].filter((s) => has(s)).join(' ').trim();
  if (plzOrt) patch.plzOrt = plzOrt;

  return { ...record, ...patch };
}
