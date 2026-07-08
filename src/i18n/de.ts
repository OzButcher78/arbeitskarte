// ============================================================================
// Single German (CH) dictionary behind the useLocale() shim.
// ----------------------------------------------------------------------------
// One flat Record<string,string>. Lifted components reference `t.someKey` (or
// `(t as any).someKey || 'fallback'`) — a Record<string,string> keeps them all
// compiling without the 5-locale machinery. New code uses these keys directly.
// Grow this file as phases lift more components.
// ============================================================================

export type Translations = Record<string, string>;

export const de: Translations = {
  // Shell
  appTitle: 'Arbeitskarte',
  version: 'Version',

  // List
  jobList: 'Arbeitskarten',
  newCard: 'Neue Karte',
  noCards: 'Noch keine Arbeitskarten erfasst.',
  search: 'Suchen (Nr, Kennzeichen, VIN, Name)…',
  colNumber: 'Nr.',
  colName: 'Name',
  colPlate: 'Kennzeichen',
  colStatus: 'Status',
  colUpdated: 'Geändert',
  open: 'Öffnen',
  delete: 'Löschen',
  confirmDelete: 'Diese Arbeitskarte wirklich löschen?',

  // Status labels
  status_offen: 'Offen',
  status_in_arbeit: 'In Arbeit',
  status_erledigt: 'Erledigt',
  status_archiviert: 'Archiviert',

  // Editor (Phase 0 stub — expands in Phase 3)
  editCard: 'Arbeitskarte',
  jobNumber: 'Auftrags-Nr.',
  fieldName: 'Name',
  fieldPlate: 'Kennzeichen',
  save: 'Speichern',
  cancel: 'Abbrechen',
  back: 'Zurück',
  saved: 'Gespeichert.',

  // Test print (Phase 0)
  testPrint: 'Test-Druck (PDF)',
  testPrintOnlyDesktop: 'PDF-Druck ist nur in der Desktop-App verfügbar.',
  printFailed: 'Druck fehlgeschlagen',

  // Editor sections + fields (Phase 1)
  settings: 'Einstellungen',
  sectionKopf: 'Kopf',
  sectionKunde: 'Kunde / Halter',
  sectionVehicle: 'Fahrzeug',
  sectionOwner: 'Halter',
  scanAusweis: 'Fahrzeugausweis scannen',
  ausweisFoto: 'Ausweisfoto',
  scanConfigureFirst: 'Bitte zuerst den Scanner in den Einstellungen einrichten.',
  vorname: 'Vorname',
  telefon: 'Telefon',
  strasse: 'Strasse',
  plzOrt: 'PLZ / Ort',
  sectionSchaden: 'Schaden',
  schadenHint: 'Beschädigte Teile antippen',
  schadenNotiz: 'Schaden-Notiz',
  noDamageSelected: 'Keine Teile markiert',
  fahrzeugmarke: 'Marke',
  fahrzeugtyp: 'Modell / Typ',
  kontrollschild: 'Kennzeichen',
  vin: 'Fahrgestellnummer (VIN)',
  stammnummer: 'Stammnummer',
  farbe: 'Farbe',
  erstzulassung: 'Erstzulassung',
  versicherung: 'Versicherung',

  // Scanner confirm-form field labels (used by DocumentScanModal via L())
  make: 'Marke',
  model: 'Modell',
  licensePlate: 'Kennzeichen',
  chassisNr: 'Fahrgestellnummer',
  color: 'Farbe',
  insurance: 'Versicherung',
  halterName: 'Name',
  halterVorname: 'Vorname',
  halterStrasse: 'Strasse',
  halterPlz: 'PLZ',
  halterOrt: 'Ort',
  close: 'Schliessen',
  retry: 'Erneut versuchen',

  // Kopf extras (Phase 3)
  repDatum: 'Rep.-Datum',
  abholdatum: 'Abholdatum',
  schluesselCode: 'Schlüssel-Code',
  ersatzwagenKopf: 'Ersatzwagen',
  automat: 'Automat',
  kilometerstand: 'Kilometerstand',
  schadenNr: 'Schaden-Nr.',
  ersatzteileJa: 'Ersatzteile',
  ersatzteileText: 'Ersatzteile (Bemerkung)',

  // Arbeiten / Material (back of card)
  sectionArbeiten: 'Arbeiten / Material',
  spenglerarbeit: 'Spenglerarbeit',
  ersatzteileKleinmat: 'Ersatzteile / Kleinmat.',
  lackierarbeit: 'Lackierarbeit',
  lackmaterial: 'Lackmaterial',
  kittsatz: 'Kittsatz',
  nebenarbeiten: 'Nebenarbeiten (Hohlraum / Porto)',
  schneidfaden: 'Schneidfaden',
  arbeitenErsatzwagen: 'Ersatzwagen',
  notes: 'Bemerkungen',

  // Photos
  sectionFotos: 'Fotos',
  addPhotoCamera: 'Kamera',
  addPhotoFile: 'Datei',
  photoMaxReached: 'Maximale Fotoanzahl erreicht.',

  // Settings modal
  settingsTitle: 'Einstellungen',
  secBetrieb: 'Betrieb',
  secNummerierung: 'Nummerierung',
  secScanner: 'Fahrzeugausweis-Scanner',
  firma: 'Firma',
  email: 'E-Mail',
  website: 'Website',
  logo: 'Logo',
  logoUpload: 'Logo wählen',
  logoRemove: 'Entfernen',
  autoNumbers: 'Automatische Nummerierung',
  numberPreview: 'Nächste Karte',
};
