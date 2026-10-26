// ============================================================================
// Data model — the real Arbeitskarte (from the two paper-card photos).
// German field names to match the card. Tier-2 (owned here; will diverge).
// ============================================================================

export type JobStatus = 'offen' | 'in_arbeit' | 'erledigt' | 'archiviert';

/** One freehand damage stroke: a polyline of [x, y] points in FlatCarMap2
 *  viewBox space ("185 460 2095 1575"), each coordinate rounded to 1 decimal. */
export type StrokePoint = [number, number];
export type DamageStroke = StrokePoint[];

export interface JobCardRecord {
  id: string; // uuid
  jobNumber: string; // auto or manual — searchable
  status: JobStatus;
  createdAt: number;
  updatedAt: number;

  // Kopf
  repDatum?: string; // Rep. Datum
  abholdatum?: string; // Abholdatum
  schluesselCode?: string; // Schlüssel-Code
  ersatzwagenKopf?: string; // "Ersatzwagen :" line (header)
  automat?: boolean; // "Automat: o" checkbox

  // Kunde (left column) — Halter block also scanned from the Ausweis (S)
  firma?: string; // company (manual)
  vorname?: string; // (S) Halter Vorname
  name?: string; // (S) Halter Name — searchable
  strasse?: string; // (S) Halter Strasse
  plzOrt?: string; // (S) Halter PLZ / Ort
  telefon?: string; // manual (not on the Ausweis)
  telefon2?: string; // second phone (manual)
  kundeNotiz?: string; // free note / remark on the customer (manual)

  // Fahrzeug (right column) — scanned fields marked (S)
  fahrzeugmarke?: string; // (S) Marke
  fahrzeugtyp?: string; // (S) Modell/Typ
  kontrollschild?: string; // (S) Kennzeichen — searchable
  vin?: string; // (S) Fahrgestellnummer — searchable
  stammnummer?: string; // (S) CH Stammnummer
  typengenehmigung?: string; // (S) CH Typengenehmigung (Ausweis Feld 24)
  farbe?: string; // (S)
  erstzulassung?: string; // (S)
  kilometerstand?: string;
  versicherung?: string; // (S) insurer name
  schadenNr?: string;

  // Schaden (car map)
  damagedParts: string[]; // selected data-panel keys of FlatCarMap2.svg (legacy ids tolerated)
  damageStrokes: DamageStroke[]; // freehand strokes drawn on the map (viewBox coords, 1-decimal)
  schadenNotiz?: string;

  // Arbeiten / Material (back of card) — free text, NO calc
  spenglerarbeit?: string;
  ersatzteileKleinmat?: string; // "Ersatzteile/Kleinmat"
  lackierarbeit?: string;
  lackmaterial?: string;
  kittsatz?: string;
  nebenarbeiten?: string; // "(Hohlraum / Porto)"
  schneidfaden?: string;
  arbeitenErsatzwagen?: string; // "Ersatzwagen" line on the back

  // Medien
  ausweisImageId?: string; // FULL original Fahrzeugausweis photo (un-redacted) — FK into blobs
  photoIds: string[]; // additional photos
  notes?: string;
}

/** Ausweis + additional photos, keyed by jobcard, stable-sorted for display. */
export interface BlobRecord {
  id: string; // uuid (used as stable filename base on export)
  jobcardId: string;
  sortOrder: number;
  kind: 'ausweis' | 'photo';
  mime: string;
  data: Blob;
  sha256?: string;
  createdAt: number;
}

export type ScanProviderId = 'infomaniak' | 'openai' | 'anthropic' | 'mistral';

export interface WorkshopIdentity {
  name: string;
  strasse: string;
  plzOrt: string;
  telefon?: string;
  email?: string;
  website?: string;
  /** data: URL of the header logo, printed on the card. */
  logoDataUrl?: string;
  /** Printed logo height in px (letterhead). Falls back to 34 when unset. */
  logoHeightPx?: number;
}

export interface AppSettings {
  workshop: WorkshopIdentity;

  // Numbering (§5.6)
  jobPrefix: string;
  jobNextNumber: number;
  autoJobNumbers: boolean;

  // Scanner (§5.1a) — local only, never synced anywhere
  docScanEnabled: boolean;
  docScanProvider: ScanProviderId;
  /** Infomaniak Produkt-ID (non-secret). The key lives in the credential store. */
  docScanProviderAccountId?: string;
  /** Optional model-id override. Providers retire model ids without notice and
   *  a dead id fails the scan with an opaque error; this lets the shop point at
   *  a current vision model without waiting for a release. Empty → the built-in
   *  default from SCAN_MODELS. */
  docScanModel?: string;
  docScanComplianceAck: boolean;
  /** Vestigial: owner-block redaction. The scanner now always sends the whole
   *  image (no crop/redaction step); kept only so old stores keep merging. */
  docScanRedactOwner: boolean;

  // Backup (Datensicherung) — plaintext JSON snapshots to a local folder.
  backupEnabled: boolean;
  backupFrequency: 'daily' | 'weekly';
  /** Electron only: the chosen destination folder (backups land in <dir>/backups).
   *  Android uses a fixed Documents/Arbeitskarte/backups; browser downloads. */
  backupDir?: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  workshop: {
    name: 'Carrosserie Spritzwerk Grab GmbH',
    strasse: 'Grundstrasse 126',
    plzOrt: '6430 Schwyz',
    telefon: '',
    email: 'info@carrosserie-grab.ch',
    website: 'www.carrosserie-grab.ch',
  },
  jobPrefix: 'AK',
  jobNextNumber: 1,
  autoJobNumbers: true,
  docScanEnabled: false,
  docScanProvider: 'infomaniak',
  docScanProviderAccountId: '',
  docScanModel: '',
  docScanComplianceAck: false,
  docScanRedactOwner: false,
  backupEnabled: false,
  backupFrequency: 'weekly',
};
