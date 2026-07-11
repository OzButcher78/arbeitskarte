// ============================================================================
// Panel registry for FlatCarMap2.svg — the canonical part list.
// ----------------------------------------------------------------------------
// The SVG owns ALL geometry AND all visual states (hover/selected fills per
// category live in its embedded <style>). This module is pure data: it maps
// each `data-panel` KEY to a German label + a category, so the app can render
// chips and print text. The category here MUST mirror the SVG's category
// classes (panel/glass/light-front/light-rear/light-indicator) so chip colours
// match the map. `data-panel` is the canonical key — never key off `id`.
// ============================================================================

/** Category — mirrors the SVG's class scheme; drives chip colour only. */
export type PanelCategory = 'body' | 'glass' | 'light-front' | 'light-rear' | 'light-indicator';

export interface PanelDef {
  key: string; // matches a data-panel value in FlatCarMap2.svg
  label: string; // CH-German (no ß)
  category: PanelCategory;
}

/** The 49 clickable panels, grouped as in the commissioned blueprint. */
export const PANEL_DEFS: PanelDef[] = [
  // Body (12)
  { key: 'MotorHaube', label: 'Motorhaube', category: 'body' },
  { key: 'Dach', label: 'Dach', category: 'body' },
  { key: 'Heckklappe', label: 'Heckklappe', category: 'body' },
  { key: 'HeckklappeUnten', label: 'Heckklappe unten', category: 'body' },
  { key: 'KotflugelVorneLinks', label: 'Kotflügel vorne links', category: 'body' },
  { key: 'KotflugelVorneRechts', label: 'Kotflügel vorne rechts', category: 'body' },
  { key: 'SeitenTeilHintenLinks', label: 'Seitenteil hinten links', category: 'body' },
  { key: 'SeitenwandHintenRechts', label: 'Seitenwand hinten rechts', category: 'body' },
  { key: 'TureVorneLinks', label: 'Türe vorne links', category: 'body' },
  { key: 'TureVorneRechts', label: 'Türe vorne rechts', category: 'body' },
  { key: 'TureHintenLinks', label: 'Türe hinten links', category: 'body' },
  { key: 'TureHintenRechts', label: 'Türe hinten rechts', category: 'body' },

  // Bumpers (6, body)
  { key: 'StossstangeVorne', label: 'Stossstange vorne', category: 'body' },
  { key: 'StossstangeHinten', label: 'Stossstange hinten', category: 'body' },
  { key: 'StossstangeVorneLinks', label: 'Stossstange vorne links', category: 'body' },
  { key: 'StossstangeVorneRechts', label: 'Stossstange vorne rechts', category: 'body' },
  { key: 'StossstangeHintenLinks', label: 'Stossstange hinten links', category: 'body' },
  { key: 'StossstangeHintenRechts', label: 'Stossstange hinten rechts', category: 'body' },

  // Glass (9)
  { key: 'FrontScheibe', label: 'Frontscheibe', category: 'glass' },
  { key: 'HeckScheibe', label: 'Heckscheibe', category: 'glass' },
  { key: 'SonnenDachScheibe', label: 'Sonnendachscheibe', category: 'glass' },
  { key: 'ScheibeVorneLinks', label: 'Scheibe vorne links', category: 'glass' },
  { key: 'ScheibeVorneRechts', label: 'Scheibe vorne rechts', category: 'glass' },
  { key: 'ScheibeHintenLinks', label: 'Scheibe hinten links', category: 'glass' },
  { key: 'ScheibeHintenRechts', label: 'Scheibe hinten rechts', category: 'glass' },
  { key: 'ScheibeSeitenTeilHintenLinks', label: 'Scheibe Seitenteil hinten links', category: 'glass' },
  { key: 'ScheibeSeitenTeilHintenRechts', label: 'Scheibe Seitenteil hinten rechts', category: 'glass' },

  // Lights (8)
  { key: 'LeuchteVorneLinks', label: 'Leuchte vorne links', category: 'light-front' },
  { key: 'LeuchteVorneRechts', label: 'Leuchte vorne rechts', category: 'light-front' },
  { key: 'BremseLeuchtHintenLinks', label: 'Bremsleuchte hinten links', category: 'light-rear' },
  { key: 'BremseLeuchtHintenRechts', label: 'Bremsleuchte hinten rechts', category: 'light-rear' },
  { key: 'BlinkerVorneLinks', label: 'Blinker vorne links', category: 'light-indicator' },
  { key: 'BlinkerVorneRechts', label: 'Blinker vorne rechts', category: 'light-indicator' },
  { key: 'BlinkerHintenLinks', label: 'Blinker hinten links', category: 'light-indicator' },
  { key: 'BlinkerHintenRechts', label: 'Blinker hinten rechts', category: 'light-indicator' },

  // Wheels (8, body)
  { key: 'ReifenVorneLinks', label: 'Reifen vorne links', category: 'body' },
  { key: 'ReifenVorneRechts', label: 'Reifen vorne rechts', category: 'body' },
  { key: 'ReifenHintenLinks', label: 'Reifen hinten links', category: 'body' },
  { key: 'ReifenHintenRechts', label: 'Reifen hinten rechts', category: 'body' },
  { key: 'FelgeVorneLinks', label: 'Felge vorne links', category: 'body' },
  { key: 'FelgeVorneRechts', label: 'Felge vorne rechts', category: 'body' },
  { key: 'FelgeHintenLinks', label: 'Felge hinten links', category: 'body' },
  { key: 'FelgeHintenRechts', label: 'Felge hinten rechts', category: 'body' },

  // Other (6, body)
  { key: 'GrillVorne', label: 'Grill vorne', category: 'body' },
  { key: 'TankDeckel', label: 'Tankdeckel', category: 'body' },
  { key: 'TureGriffVorneLinks', label: 'Türgriff vorne links', category: 'body' },
  { key: 'TureGriffVorneRechts', label: 'Türgriff vorne rechts', category: 'body' },
  { key: 'TureGriffHintenLinks', label: 'Türgriff hinten links', category: 'body' },
  { key: 'TureGriffHintenRechts', label: 'Türgriff hinten rechts', category: 'body' },
];

export const PANEL_LABELS: Record<string, string> = Object.fromEntries(
  PANEL_DEFS.map((p) => [p.key, p.label]),
);

export const PANEL_CATEGORIES: Record<string, PanelCategory> = Object.fromEntries(
  PANEL_DEFS.map((p) => [p.key, p.category]),
);

// ── Legacy ids (old regions.ts map) ─────────────────────────────────────────
// Cards saved against the old top-down diagram used these ids. The Dexie v2
// upgrade remaps the ones with a new-map equivalent; the rest (schwellerL/R,
// roofRailL/R — no panel on the new blueprint) are kept verbatim in
// damagedParts and only rendered as chips / print text (see decision 1).

/** Old id → new data-panel key (16 that have an equivalent). */
export const LEGACY_PANEL_MIGRATION: Record<string, string> = {
  frontStossstange: 'StossstangeVorne',
  heckStossstange: 'StossstangeHinten',
  hood: 'MotorHaube',
  roof: 'Dach',
  trunkUpper: 'Heckklappe',
  trunkLower: 'HeckklappeUnten',
  fenderFL: 'KotflugelVorneLinks',
  fenderFR: 'KotflugelVorneRechts',
  doorFL: 'TureVorneLinks',
  doorFR: 'TureVorneRechts',
  doorRL: 'TureHintenLinks',
  doorRR: 'TureHintenRechts',
  quarterPanelL: 'SeitenTeilHintenLinks',
  quarterPanelR: 'SeitenwandHintenRechts',
  windschutzscheibe: 'FrontScheibe',
  heckscheibe: 'HeckScheibe',
};

/** German labels for ALL 20 legacy ids — label fallback for stored ids that
 *  were never migrated (schwellerL/R, roofRailL/R) or on un-upgraded reads. */
export const LEGACY_LABELS: Record<string, string> = {
  frontStossstange: 'Frontstossstange',
  hood: 'Motorhaube',
  fenderFL: 'Kotflügel VL',
  doorFL: 'Tür VL',
  doorRL: 'Tür HL',
  quarterPanelL: 'Seitenwand HL',
  roofRailL: 'Dachrahmen L',
  schwellerL: 'Schweller L',
  roof: 'Dach',
  trunkUpper: 'Kofferraumdeckel',
  trunkLower: 'Heckabschluss',
  roofRailR: 'Dachrahmen R',
  fenderFR: 'Kotflügel VR',
  doorFR: 'Tür VR',
  doorRR: 'Tür HR',
  quarterPanelR: 'Seitenwand HR',
  schwellerR: 'Schweller R',
  heckStossstange: 'Heckstossstange',
  windschutzscheibe: 'Windschutzscheibe',
  heckscheibe: 'Heckscheibe',
};

/** Human label for a stored part id: new panel → legacy label → raw id. */
export function panelLabel(id: string): string {
  return PANEL_LABELS[id] ?? LEGACY_LABELS[id] ?? id;
}

/** Category for a stored part id (unknown / legacy ids fall back to 'body'). */
export function panelCategory(id: string): PanelCategory {
  return PANEL_CATEGORIES[id] ?? 'body';
}
