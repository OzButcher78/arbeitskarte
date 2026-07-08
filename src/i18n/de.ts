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
};
