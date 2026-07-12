// ============================================================================
// Local (offline) OCR parser — anchor + pattern extraction of a Swiss
// Fahrzeugausweis from Tesseract word boxes.
// ----------------------------------------------------------------------------
// PURE module: no DOM, no Node, no tesseract import. The SAME code runs in the
// accuracy spike (tools/ocr-spike) and — once the gate passes — inside the app
// (src/scan/documentScanner.ts). Living under src/ means `npm run typecheck`
// covers it from day one.
//
// Input: the flat list of recognised words (text + confidence + pixel bbox) plus
// the image dimensions. Output: the same `ScanFields` the cloud path produces,
// plus a per-field mean-confidence map. Downstream, `sanitizeScanFields` +
// `normalize*` (the cloud path's own guards) still run over these fields, so this
// parser only has to *locate* values — it does not need to be the last word on
// validity.
//
// Strategy (per plan Phase A1):
//   1. group words into horizontal row bands by vertical bbox overlap;
//   2. ANCHOR pass — fuzzy-match printed form labels / field numbers and read the
//      typewriter value words to their right / below within the band;
//   3. PATTERN pass — scan every word for hard formats (17-char VIN, dotted
//      Stammnummer, cantonal plate, date) independent of position;
//   4. MERGE — anchor wins when it yields a valid value, pattern fills the gaps;
//      snap make/colour to KNOWN_MAKES / KNOWN_COLORS; cross-check the VIN WMI
//      via decodeVin.
//
// The Swiss Fahrzeugausweis is trilingual (DE/FR/IT); anchors carry all three.
// ============================================================================

import {
  normalizeVin,
  normalizePlate,
  normalizeStammnummer,
  normForLookup,
  KNOWN_COLORS,
  KNOWN_MAKES,
} from '../scanProviders';
import { decodeVin } from '../vinDecode';
import type { ScanFields } from '../scanProviders';
// Reuse the geometry we already trust for the owner (Halter) block: pure,
// DOM-free module — keeps this parser pure and works under tsx in the spike.
import { defaultRedactionBox, type Rect } from '../scanRedaction';

// ----------------------------------------------------------------------------
// Public contract
// ----------------------------------------------------------------------------

export interface OcrBBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** One recognised word. `confidence` is Tesseract's 0–100 scale. */
export interface OcrWord {
  text: string;
  confidence: number;
  bbox: OcrBBox;
}

export interface ParseOcrResult {
  fields: ScanFields;
  /** Mean word confidence (0–100) for the words that produced each field. */
  confidence: Partial<Record<keyof ScanFields, number>>;
}

// ----------------------------------------------------------------------------
// Internal word model (normalised text + centre coords cached)
// ----------------------------------------------------------------------------

interface PWord {
  raw: string;
  norm: string;
  conf: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  h: number;
  w: number;
}

interface Band {
  words: PWord[];
  yMin: number;
  yMax: number;
}

function toPWord(w: OcrWord): PWord {
  const { x0, y0, x1, y1 } = w.bbox;
  // OCR routinely prepends/appends stray punctuation to label words ("‚Assurance",
  // "Nom,", "[23"). Strip it from the lookup form so stopword / dictionary matches
  // are not defeated by a leading glyph.
  const norm = normForLookup(w.text).replace(/^[^0-9a-z]+/, '').replace(/[^0-9a-z]+$/, '');
  return {
    raw: w.text,
    norm,
    conf: typeof w.confidence === 'number' && isFinite(w.confidence) ? w.confidence : 0,
    x0, y0, x1, y1,
    cx: (x0 + x1) / 2,
    cy: (y0 + y1) / 2,
    h: Math.max(1, y1 - y0),
    w: Math.max(1, x1 - x0),
  };
}

/** Cluster words into visual rows by vertical bbox overlap. */
function groupBands(words: PWord[]): Band[] {
  const sorted = [...words].sort((a, b) => a.cy - b.cy);
  const bands: Band[] = [];
  for (const w of sorted) {
    let placed = false;
    for (const band of bands) {
      const overlap = Math.min(w.y1, band.yMax) - Math.max(w.y0, band.yMin);
      const minH = Math.min(w.h, band.yMax - band.yMin);
      if (overlap > 0.35 * minH) {
        band.words.push(w);
        band.yMin = Math.min(band.yMin, w.y0);
        band.yMax = Math.max(band.yMax, w.y1);
        placed = true;
        break;
      }
    }
    if (!placed) bands.push({ words: [w], yMin: w.y0, yMax: w.y1 });
  }
  for (const b of bands) b.words.sort((a, z) => a.x0 - z.x0);
  bands.sort((a, b) => a.yMin - b.yMin);
  return bands;
}

// ----------------------------------------------------------------------------
// Small text utilities
// ----------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** Does `word` look like `label`? Exact / prefix / contained / edit-distance ≤ tol. */
function labelMatch(word: string, label: string, tol = 1): boolean {
  if (!word || !label) return false;
  if (word === label) return true;
  if (label.length >= 5 && (word.startsWith(label) || label.startsWith(word))) return true;
  if (label.length >= 6 && word.includes(label)) return true;
  const maxTol = label.length >= 8 ? tol + 1 : tol;
  if (Math.abs(word.length - label.length) <= maxTol && levenshtein(word, label) <= maxTol) return true;
  return false;
}

/** First index in `band.words` whose normalised text matches any label, or a
 *  bare field number equal to any of `numbers`. Returns -1 if none. */
function findAnchorIndex(band: Band, labels: string[], numbers: string[]): number {
  for (let i = 0; i < band.words.length; i++) {
    const w = band.words[i];
    if (numbers.length && numbers.includes(w.raw.replace(/[^0-9]/g, ''))) return i;
    for (const lab of labels) if (labelMatch(w.norm, lab)) return i;
    // two-word label like "marke und typ": try joining with the next word
    if (i + 1 < band.words.length) {
      const joined = `${w.norm} ${band.words[i + 1].norm}`;
      for (const lab of labels) if (lab.includes(' ') && labelMatch(joined, lab)) return i;
    }
  }
  return -1;
}

/** Words to the right of `fromIdx` on the same band (the typed value). */
function wordsRightOf(band: Band, fromIdx: number): PWord[] {
  return band.words.slice(fromIdx + 1);
}

function meanConf(words: PWord[]): number {
  if (!words.length) return 0;
  return words.reduce((s, w) => s + w.conf, 0) / words.length;
}

// ----------------------------------------------------------------------------
// Anchor label dictionaries (normalised: lowercase, no accents) — DE / FR / IT
// Field numbers from the standardised Swiss form (per plan A1).
// ----------------------------------------------------------------------------

const A = {
  plate: {
    labels: ['kontrollschild', 'kontrollschilder', 'schild', 'immatriculation', 'plaque', 'targa'],
    numbers: ['15'],
  },
  markeTyp: {
    labels: ['marke und typ', 'marke', 'marque et type', 'marque', 'marca e tipo', 'marca'],
    numbers: ['21'],
  },
  typ: {
    labels: ['typ', 'type', 'tipo'],
    numbers: ['22'],
  },
  vin: {
    labels: ['fahrgestell', 'fahrgestell-nr', 'fahrgestellnummer', 'chassis', 'telaio'],
    numbers: ['23'],
  },
  farbe: {
    labels: ['farbe', 'couleur', 'colore'],
    numbers: ['26'],
  },
  stammnummer: {
    labels: ['stammnummer', 'matricule', 'matricola'],
    numbers: ['18'],
  },
  erstzulassung: {
    labels: [
      '1 inverkehrsetzung', 'inverkehrsetzung', 'inverkehrsetz',
      'mise en circulation', 'messa in circolazione',
    ],
    numbers: ['36'],
  },
  versicherung: {
    labels: ['versicherung', 'assurance', 'assicurazione'],
    numbers: ['09', '9'],
  },
  halter: {
    labels: ['halter', 'detenteur', 'detentore', 'titulaire'],
    numbers: [],
  },
  name: {
    labels: ['name', 'nom', 'cognome', 'vornamen', 'name vornamen'],
    numbers: [],
  },
  wohnort: {
    labels: ['wohnort', 'domicile', 'domicilio', 'adresse', 'wohnort und adresse'],
    numbers: [],
  },
  // Other dates on the card that must NOT be taken as the first registration.
  geburtsdatum: {
    labels: ['geburtsdatum', 'geburtsdat', 'naissance', 'nascita', 'nasch', 'data di nascita'],
    numbers: [],
  },
  pruefung: {
    labels: ['prufung', 'prufungen', 'prufunger', 'experten', 'expertise', 'expertises', 'perizie', 'examinaziuns'],
    numbers: [],
  },
} as const;

// 26 Swiss cantonal codes — the plate letter prefix whitelist.
const CANTONS = new Set([
  'AG', 'AI', 'AR', 'BE', 'BL', 'BS', 'FR', 'GE', 'GL', 'GR', 'JU', 'LU', 'NE',
  'NW', 'OW', 'SG', 'SH', 'SO', 'SZ', 'TG', 'TI', 'UR', 'VD', 'VS', 'ZG', 'ZH',
]);

// Swiss motor insurers — a dictionary hit is a far cleaner signal than reading
// free text next to the "Versicherung" label (which is often a policy number).
const KNOWN_INSURERS: ReadonlyMap<string, string> = new Map(
  (
    [
      ['AXA', ['axa']],
      ['Zürich', ['zurich', 'zürich']],
      ['Die Mobiliar', ['mobiliar', 'mobiliere', 'mobilière', 'mobiliar']],
      ['Helvetia', ['helvetia']],
      ['Baloise', ['baloise', 'basler']],
      ['Vaudoise', ['vaudoise']],
      ['Allianz', ['allianz']],
      ['Generali', ['generali']],
      ['Smile', ['smile']],
      ['TCS', ['tcs']],
      ['Elvia', ['elvia']],
      ['Winterthur', ['winterthur']],
      ['Simpego', ['simpego']],
      ['Dextra', ['dextra']],
    ] as ReadonlyArray<[string, string[]]>
  ).flatMap(([canonical, aliases]) => aliases.map((a) => [normForLookup(a), canonical] as [string, string])),
);

// Words that must never be taken as a free-text value (form labels / headings /
// multilingual echoes seen on the real cards). A value scan STOPS at the first
// of these, so a value can never bleed into the next printed label.
const LABEL_STOPWORDS = new Set(
  [
    // field labels (DE/FR/IT)
    'marke', 'marque', 'marca', 'typ', 'type', 'tipo', 'modell', 'modele', 'modello',
    'farbe', 'couleur', 'colore', 'fahrgestell', 'chassis', 'telaio', 'stammnummer',
    'matricule', 'matricola', 'versicherung', 'assurance', 'assicurazione', 'halter',
    'detenteur', 'detentore', 'name', 'nom', 'noms', 'prenoms', 'prenom', 'vornamen',
    'vorname', 'nomi', 'cognome', 'wohnort', 'domicile', 'domicilio', 'adresse',
    'kontrollschild', 'immatriculation', 'inverkehrsetzung', 'code', 'und', 'nr',
    // headings / other form fields that sit next to our values
    'karosserie', 'carrosserie', 'carrozzeria', 'prestazioni', 'carica', 'genre',
    'genere', 'gener', 'art', 'arten', 'usage', 'uso', 'verwendung', 'fahrzeug',
    'fahrzeugs', 'fahrzeuges', 'veicolo', 'veicoli', 'vehicule', 'vehichel',
    'personenwagen', 'siehe', 'des', 'del', 'della', 'bes', 'spezial', 'special',
    'speciale', 'speciali', 'spez',
  ].map(normForLookup),
);

/** True if a token IS a form label or an OCR-mangled one (edit-distance ≤1) —
 *  catches echoes like "num"≈"nom", "prenums"≈"prenoms", "domicil"≈"domicile". */
function looksLikeLabel(norm: string): boolean {
  if (!norm) return false;
  if (LABEL_STOPWORDS.has(norm)) return true;
  if (norm.length < 3) return false;
  for (const s of LABEL_STOPWORDS) {
    if (s.length >= 3 && Math.abs(s.length - norm.length) <= 1 && levenshtein(norm, s) <= 1) return true;
  }
  return false;
}

/** Trim a run of value words: drop punctuation-only / label tokens, STOP at the
 *  first form label, and cap the count — so a value never swallows a whole row. */
function cleanTokens(words: PWord[], maxTokens: number): PWord[] {
  const out: PWord[] = [];
  for (const w of words) {
    if (LABEL_STOPWORDS.has(w.norm)) break;
    const alnum = w.raw.replace(/[^0-9A-Za-zÀ-ÿ]/g, '');
    if (!alnum) continue; // punctuation-only garbage ("|", ".", "‚")
    out.push(w);
    if (out.length >= maxTokens) break;
  }
  return out;
}

/** For each band carrying an anchor, its left x-column (so a value can be required
 *  to sit at/right of the printed label). */
function anchorColumns(bands: Band[], labels: string[], numbers: string[]): Map<number, number> {
  const m = new Map<number, number>();
  bands.forEach((b, i) => {
    const idx = findAnchorIndex(b, labels, numbers);
    if (idx >= 0) m.set(i, b.words[idx].x0);
  });
  return m;
}

// ----------------------------------------------------------------------------
// Field extractors
// ----------------------------------------------------------------------------

interface FieldHit {
  value: string;
  conf: number;
}

function validDMY(d: number, m: number, y: number): boolean {
  return d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1900 && y <= 2099;
}

/** True if a digit string embeds a valid date (7- or 8-digit d[d].m[m].yyyy /
 *  yyyymmdd). A birthdate mangled into a 17-char run ("…2011964…" = 2.01.1964)
 *  makes a false VIN; a REAL VIN's ≥7-digit serial runs decode to impossible
 *  years (e.g. "5057767" → 7767), so this rejects the former and keeps the
 *  latter. Only runs of ≥7 consecutive digits are examined. */
function embedsDate(chars: string): boolean {
  const runs = chars.match(/\d{7,}/g) || [];
  for (const r of runs) {
    for (let i = 0; i + 8 <= r.length; i++) {
      const s = r.slice(i, i + 8);
      if (validDMY(+s.slice(0, 2), +s.slice(2, 4), +s.slice(4, 8))) return true; // ddmmyyyy
      if (validDMY(+s.slice(6, 8), +s.slice(4, 6), +s.slice(0, 4))) return true; // yyyymmdd
    }
    for (let i = 0; i + 7 <= r.length; i++) {
      const s = r.slice(i, i + 7);
      if (validDMY(+s.slice(0, 1), +s.slice(1, 3), +s.slice(3, 7))) return true; // d.mm.yyyy
      if (validDMY(+s.slice(0, 2), +s.slice(2, 3), +s.slice(3, 7))) return true; // dd.m.yyyy
    }
  }
  return false;
}

/** VIN: sweep concatenated alphanumerics for a 17-char window that survives the
 *  I/O/Q repair + charset. The repair invents digits from letters (O→0, I→1), so
 *  an all-letter LABEL word (e.g. "PRESTAZIONI") would otherwise masquerade as a
 *  VIN — we therefore only ACCEPT a candidate that is anchored to the
 *  Fahrgestell/Chassis row, OR whose WMI decodes, OR is a single token carrying
 *  ≥4 real (pre-repair) digits. Ranking then puts the anchored one on top. */
function extractVin(bands: Band[], vinAnchorX: Map<number, number>): FieldHit | null {
  interface Cand {
    vin: string; conf: number; wmiKnown: boolean; nearAnchor: boolean; singleToken: boolean; origDigits: number;
  }
  const cands: Cand[] = [];

  const consider = (alnum: string, conf: number, nearAnchor: boolean, singleToken: boolean) => {
    const up = alnum.toUpperCase();
    const rep = up.replace(/I/g, '1').replace(/O/g, '0').replace(/Q/g, '0');
    for (let i = 0; i + 17 <= rep.length; i++) {
      const cand = rep.slice(i, i + 17);
      if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(cand)) continue;
      if (!/[0-9]/.test(cand) || !/[A-Z]/.test(cand)) continue; // must mix
      const origWindow = up.slice(i, i + 17);
      if (embedsDate(origWindow)) continue; // birthdate/date mangled into a run
      const origDigits = (origWindow.match(/[0-9]/g) || []).length;
      const wmiKnown = !!decodeVin(cand).make;
      // A real VIN carries several genuine (pre-repair) digits — its serial alone
      // is mostly numeric. Label text has ~none; the I/O/Q→digit repair only fakes
      // them. So gate on origDigits FIRST, then require the candidate be either
      // anchored to the Fahrgestell/Chassis row (decently read) or a WMI-decoding
      // number. Kills "PRESTAZIONI", "ANNOTAZIONI CANTONALES", "SFAUANN…" and the
      // birthdate-near-chassis run (few real digits / no WMI).
      const accept =
        origDigits >= 4 && ((nearAnchor && conf >= 55) || (wmiKnown && origDigits >= 6 && conf >= 65));
      if (!accept) continue;
      cands.push({ vin: cand, conf, wmiKnown, nearAnchor, singleToken, origDigits });
    }
  };

  bands.forEach((band, bi) => {
    // The VIN is the value AT or RIGHT OF its Fahrgestell/Chassis label — never to
    // its left (on card 3 the owner's birthdate lands left of the label in the same
    // OCR band). So a join only counts as anchored when it starts at/after the
    // label's column.
    const anchorX = vinAnchorX.get(bi);
    const ws = band.words;
    for (let i = 0; i < ws.length; i++) {
      const near = anchorX !== undefined && ws[i].x0 >= anchorX - 5;
      let joined = '';
      let confSum = 0;
      let n = 0;
      for (let j = i; j < ws.length && j < i + 6; j++) {
        joined += ws[j].raw.replace(/[^A-Za-z0-9]/g, '');
        confSum += ws[j].conf;
        n++;
        if (joined.length >= 17) consider(joined, confSum / n, near, n === 1);
      }
    }
  });

  if (!cands.length) return null;
  const score = (c: Cand) =>
    (c.nearAnchor ? 1000 : 0) + (c.wmiKnown ? 50 : 0) + (c.singleToken ? 20 : 0) + c.origDigits * 3 + c.conf * 0.1;
  cands.sort((a, b) => score(b) - score(a));
  return { value: cands[0].vin, conf: cands[0].conf };
}

/** Stammnummer: the distinctive dotted 9-digit group `123.456.789`. A real
 *  punctuation separator between each 3-digit group is MANDATORY (a bare 9-digit
 *  run must never qualify), but OCR noise inside it is tolerated — e.g.
 *  "233.487/.818" (a stray slash) still parses. */
function extractStammnummer(bands: Band[]): FieldHit | null {
  const re = /(?<!\d)(\d{3})([\s.'·/,]{1,3})(\d{3})([\s.'·/,]{1,3})(\d{3})(?!\d)/;
  const punct = /[.'·/,]/; // at least one true separator per gap (not just spaces)
  for (const band of bands) {
    // join the band so a split "123 . 456 . 789" still matches
    const joined = band.words.map((w) => w.raw).join(' ');
    const m = joined.match(re);
    if (m && punct.test(m[2]) && punct.test(m[4])) {
      const digits = m[1] + m[3] + m[5];
      return { value: `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`, conf: meanConf(band.words) };
    }
  }
  return null;
}

/** Cantonal plate: "SZ 12345" — a whitelisted 2-letter canton + 1–6 digits,
 *  either in one token or split across two adjacent tokens. */
function extractPlate(bands: Band[]): FieldHit | null {
  interface Cand { value: string; conf: number; y: number }
  const cands: Cand[] = [];
  for (const band of bands) {
    const ws = band.words;
    for (let i = 0; i < ws.length; i++) {
      const t = ws[i].raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const one = t.match(/^([A-Z]{2})(\d{1,6})$/);
      if (one && CANTONS.has(one[1])) {
        cands.push({ value: `${one[1]} ${one[2]}`, conf: ws[i].conf, y: ws[i].y0 });
        continue;
      }
      // split across two tokens: "SZ" | "12345"
      if (/^[A-Z]{2}$/.test(t) && CANTONS.has(t) && i + 1 < ws.length) {
        const d = ws[i + 1].raw.replace(/[^0-9]/g, '');
        if (/^\d{1,6}$/.test(d) && d.length >= 2) {
          cands.push({ value: `${t} ${d}`, conf: (ws[i].conf + ws[i + 1].conf) / 2, y: ws[i].y0 });
        }
      }
    }
  }
  if (!cands.length) return null;
  // plate sits high on the ausweis; prefer topmost, then confidence
  cands.sort((a, b) => a.y - b.y || b.conf - a.conf);
  return { value: cands[0].value, conf: cands[0].conf };
}

const DATE_RE = /^(\d{1,2})[.,](\d{1,2})[.,](\d{2,4})$/;

function plausibleYear(y: number): boolean {
  const current = new Date().getFullYear();
  const yr = y < 100 ? (y > 50 ? 1900 + y : 2000 + y) : y;
  return yr >= 1900 && yr <= current + 1;
}

/** All date-shaped tokens with their centre position. */
function collectDates(bands: Band[]): { value: string; conf: number; cx: number; cy: number }[] {
  const out: { value: string; conf: number; cx: number; cy: number }[] = [];
  for (const band of bands) {
    for (const w of band.words) {
      const t = w.raw.replace(/\s+/g, '');
      const m = t.match(DATE_RE);
      if (m && plausibleYear(parseInt(m[3], 10))) {
        const dd = m[1].padStart(2, '0');
        const mm = m[2].padStart(2, '0');
        out.push({ value: `${dd}.${mm}.${m[3]}`, conf: w.conf, cx: w.cx, cy: w.cy });
      }
    }
  }
  return out;
}

/** Centre of the first word matching an anchor, else null. */
function anchorCentre(bands: Band[], labels: string[], numbers: string[]): { cx: number; cy: number } | null {
  for (const band of bands) {
    const idx = findAnchorIndex(band, labels, numbers);
    if (idx >= 0) return { cx: band.words[idx].cx, cy: band.words[idx].cy };
  }
  return null;
}

/** Erstzulassung: the date nearest the "1. Inverkehrsetzung" TEXT label — never
 *  the birthdate (field 07) or an expertise date (field 39), which are dropped
 *  when they sit closer to their own label. The bare field number "36" is NOT an
 *  anchor (too many stray "36"s), and without the text label we return null
 *  rather than guess (the old "earliest date" fallback grabbed the birthdate). */
function extractDate(bands: Band[]): FieldHit | null {
  const dates = collectDates(bands);
  if (!dates.length) return null;
  const inv = anchorCentre(bands, [...A.erstzulassung.labels], []);
  if (!inv) return null;
  const geb = anchorCentre(bands, [...A.geburtsdatum.labels], []);
  const pruef = anchorCentre(bands, [...A.pruefung.labels], []);
  const dist = (a: { cx: number; cy: number }, d: { cx: number; cy: number }) => Math.hypot(d.cx - a.cx, d.cy - a.cy);
  const pool = dates.filter((d) => {
    const di = dist(inv, d);
    if (geb && dist(geb, d) < di) return false; // belongs to the birthdate field
    if (pruef && dist(pruef, d) < di) return false; // belongs to the expertise field
    return true;
  });
  if (!pool.length) return null;
  pool.sort((p, q) => dist(inv, p) - dist(inv, q));
  return { value: pool[0].value, conf: pool[0].conf };
}

/** Colour: dictionary scan over every word; snap to canonical KNOWN_COLORS. */
function extractColor(bands: Band[]): FieldHit | null {
  // 1) prefer a colour word to the right of the "Farbe" anchor
  for (const band of bands) {
    const idx = findAnchorIndex(band, [...A.farbe.labels], [...A.farbe.numbers]);
    if (idx < 0) continue;
    for (const w of wordsRightOf(band, idx)) {
      if (KNOWN_COLORS.has(w.norm)) return { value: w.raw, conf: w.conf };
    }
  }
  // 2) any known colour word anywhere
  for (const band of bands) {
    for (const w of band.words) {
      if (KNOWN_COLORS.has(w.norm)) return { value: w.raw, conf: w.conf };
    }
  }
  return null;
}

/** Make + model. The make is taken dictionary-first: the first KNOWN_MAKES token
 *  anywhere (BMW, PEUGEOT, …) is a far stronger signal than "first word after the
 *  Marke label", which on these trilingual forms is usually a label echo ("tip",
 *  "Marca"). The model is the value tokens following the make on its own row.
 *  A make not in the dictionary yields null (the user types it) — never a guess. */
function extractMakeModel(bands: Band[]): { make: FieldHit | null; model: FieldHit | null } {
  // keep model tokens with ≥2 alphanumerics ("X1", "208") — drop stray "e" / "|".
  const modelTok = (w: PWord) => w.raw.replace(/[^0-9A-Za-zÀ-ÿ]/g, '').length >= 2;

  for (const band of bands) {
    const ws = band.words;
    for (let i = 0; i < ws.length; i++) {
      if (!KNOWN_MAKES.has(ws[i].norm)) continue;
      const make: FieldHit = { value: KNOWN_MAKES.get(ws[i].norm)!, conf: ws[i].conf };
      const tail = cleanTokens(ws.slice(i + 1), 3).filter(modelTok);
      const model = tail.length ? { value: tail.map((w) => w.raw).join(' '), conf: meanConf(tail) } : null;
      return { make, model };
    }
  }
  return { make: null, model: null };
}

/** Insurance company — dictionary-only (a KNOWN_INSURERS token anywhere). The
 *  free text next to the "Versicherung" label is almost always a policy number or
 *  a trilingual label echo, so we never read it: an unknown insurer → null, which
 *  the user fills in, rather than emitting "09 Assicuranza" / a plate fragment. */
function extractInsurance(bands: Band[]): FieldHit | null {
  for (const band of bands) {
    for (const w of band.words) {
      const canon = KNOWN_INSURERS.get(w.norm);
      if (canon) return { value: canon, conf: w.conf };
    }
  }
  return null;
}

// A candidate free-text word for a name/town/street value: real letters, not a
// form label, not an insurer name. `strict` (min 3 letters) rejects OCR fragments
// like "Dt" on the name/street paths; the loose {2,} form keeps short town words.
function isNameWord(w: PWord): boolean {
  return /[A-Za-zÀ-ÿ]{2,}/.test(w.raw) && !looksLikeLabel(w.norm) && !KNOWN_INSURERS.has(w.norm);
}
function isNameWordStrict(w: PWord): boolean {
  return /[A-Za-zÀ-ÿ]{3,}/.test(w.raw) && !looksLikeLabel(w.norm) && !KNOWN_INSURERS.has(w.norm);
}

/** Keep only the words whose bbox centre falls inside a padded region Rect. */
function wordsInRegion(pwords: PWord[], region: Rect, padX: number, padY: number): PWord[] {
  const x0 = region.x - padX;
  const x1 = region.x + region.w + padX;
  const y0 = region.y - padY;
  const y1 = region.y + region.h + padY;
  return pwords.filter((w) => w.cx >= x0 && w.cx <= x1 && w.cy >= y0 && w.cy <= y1);
}

/** Split a name value-run into surname / given names. Honours the Swiss
 *  "Name, Vornamen" comma convention (everything up to the comma = surname, so a
 *  multi-word surname like "Von Dach" survives); with no comma the first token is
 *  the surname and the rest are given names. Strict (min-3-letter) filtering drops
 *  OCR fragments, so a stray "Dt" never wins. */
function splitNameVorname(words: PWord[]): { name: FieldHit | null; vorname: FieldHit | null } {
  if (!words.length) return { name: null, vorname: null };
  const commaIdx = words.findIndex((w) => w.raw.includes(','));
  const surnameToks = commaIdx >= 0 ? words.slice(0, commaIdx + 1) : words.slice(0, 1);
  const givenToks = commaIdx >= 0 ? words.slice(commaIdx + 1) : words.slice(1);
  const build = (toks: PWord[]): FieldHit | null => {
    const kept = toks
      .map((w) => ({ raw: w.raw.replace(/,/g, '').trim(), conf: w.conf, norm: w.norm }))
      .filter((w) => /[A-Za-zÀ-ÿ]{3,}/.test(w.raw) && !looksLikeLabel(w.norm) && !KNOWN_INSURERS.has(w.norm));
    if (!kept.length) return null;
    return {
      value: kept.map((w) => w.raw).join(' '),
      conf: kept.reduce((s, w) => s + w.conf, 0) / kept.length,
    };
  };
  return { name: build(surnameToks), vorname: build(givenToks) };
}

/** From a band's words, drop LEADING label / punctuation / serial-number tokens,
 *  then take the value tokens up to the next label (≤ `max`). Unlike `cleanTokens`
 *  this does not stop at a LEADING form label: on the Fahrzeugausweis the printed
 *  "Name, Vornamen" / "Wohnort" labels sit to the LEFT of their value on the same
 *  row, so we must skip past them to reach "Bühler Hans-Ueli" / "Rütimatt 5". */
function valueAfterLabels(words: PWord[], max: number): PWord[] {
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    const alnum = w.raw.replace(/[^0-9A-Za-zÀ-ÿ]/g, '');
    if (!alnum) { i++; continue; }                  // punctuation-only
    if (looksLikeLabel(w.norm)) { i++; continue; }  // a printed field label
    if (/^\d{3,}$/.test(alnum)) { i++; continue; }  // a leading serial/card number
    break;
  }
  const out: PWord[] = [];
  for (; i < words.length && out.length < max; i++) {
    const w = words[i];
    const alnum = w.raw.replace(/[^0-9A-Za-zÀ-ÿ]/g, '');
    if (!alnum) continue;
    if (looksLikeLabel(w.norm)) break;              // a trailing label = next field
    out.push(w);
  }
  return out;
}

/** PLZ + Ort: "8840 Einsiedeln" — a 4-digit token (1000–9999) followed by ≤3 town
 *  words. Returns the band index of the hit so the street scan can stay above it. */
function scanPlzOrt(bands: Band[]): { plz: FieldHit; ort: FieldHit; bandIdx: number } | null {
  for (let bi = 0; bi < bands.length; bi++) {
    const ws = bands[bi].words;
    for (let i = 0; i < ws.length; i++) {
      const d = ws[i].raw.replace(/[^0-9]/g, '');
      if (d.length === 4 && /^\d{4}$/.test(d)) {
        const n = parseInt(d, 10);
        if (n < 1000 || n > 9999) continue;
        const townWords = cleanTokens(ws.slice(i + 1), 3).filter(isNameWord);
        if (townWords.length) {
          return {
            plz: { value: d, conf: ws[i].conf },
            ort: { value: townWords.map((w) => w.raw).join(' '), conf: meanConf(townWords) },
            bandIdx: bi,
          };
        }
      }
    }
  }
  return null;
}

/** Legacy (pre-region) name + street: requires the printed Halter/Name label and
 *  a street keyword + house number. Kept as the fallback for when there is no
 *  usable Halter region (protects the paths that already worked). */
function legacyNameStreet(bands: Band[]): {
  name: FieldHit | null; vorname: FieldHit | null; strasse: FieldHit | null;
} {
  let name: FieldHit | null = null;
  let vorname: FieldHit | null = null;
  let strasse: FieldHit | null = null;

  let start = -1;
  for (let i = 0; i < bands.length; i++) {
    if (findAnchorIndex(bands[i], [...A.halter.labels, ...A.name.labels], []) >= 0) { start = i; break; }
  }
  if (start < 0) return { name, vorname, strasse };
  const searchBands = bands.slice(start, start + 6);

  for (let bi = start; bi < Math.min(bands.length, start + 6); bi++) {
    const idx = findAnchorIndex(bands[bi], [...A.name.labels], []);
    if (idx < 0) continue;
    let val = cleanTokens(wordsRightOf(bands[bi], idx), 4);
    if (!val.length && bi + 1 < bands.length) val = cleanTokens(bands[bi + 1].words, 4);
    const split = splitNameVorname(val);
    name = split.name;
    vorname = split.vorname;
    break;
  }

  for (const band of searchBands) {
    const joined = band.words.map((w) => w.raw).join(' ');
    if (/[A-Za-zÀ-ÿ].*\d{1,4}[a-z]?\b/.test(joined) && /(strasse|str\.|weg|gasse|platz|route|via|chemin)/i.test(joined)) {
      const ws = cleanTokens(band.words, 5);
      if (ws.length) strasse = { value: ws.map((w) => w.raw).join(' ').trim(), conf: meanConf(ws) };
      break;
    }
  }
  return { name, vorname, strasse };
}

/** Halter (keeper) name + address. Region-first: restrict to the owner block
 *  (the geometry we already trust — `defaultRedactionBox`), re-band that subset so
 *  the right (vehicle) column can no longer jumble reading order, then read
 *  name / street / PLZ positionally. Every sub-extractor falls back to the legacy
 *  whole-image behaviour when the region has no usable content, so today's working
 *  paths (notably PLZ/Ort) never regress. */
function extractHalter(
  bands: Band[],
  pwords: PWord[],
  imageWidth: number,
  imageHeight: number,
  country?: string,
): {
  vorname: FieldHit | null; name: FieldHit | null;
  strasse: FieldHit | null; plz: FieldHit | null; ort: FieldHit | null;
} {
  // ── Region restriction: keep only the Halter-block words, re-band them ──
  const haveDims = imageWidth > 0 && imageHeight > 0;
  const region = haveDims ? defaultRedactionBox(country, imageWidth, imageHeight) : null;
  const regionBands = region
    ? groupBands(wordsInRegion(pwords, region, imageWidth * 0.04, imageHeight * 0.06))
    : [];
  const regionUsable = regionBands.some((b) => b.words.some(isNameWordStrict));

  // ── PLZ / Ort: region first, whole-image fallback (never hard-restricted) ──
  let plz: FieldHit | null = null;
  let ort: FieldHit | null = null;
  let plzBandIdx = -1;
  if (regionUsable) {
    const hit = scanPlzOrt(regionBands);
    if (hit) { plz = hit.plz; ort = hit.ort; plzBandIdx = hit.bandIdx; }
  }
  if (!plz) {
    const hit = scanPlzOrt(bands);
    if (hit) { plz = hit.plz; ort = hit.ort; }
  }

  // ── Name / Vorname / Strasse ──
  let name: FieldHit | null = null;
  let vorname: FieldHit | null = null;
  let strasse: FieldHit | null = null;

  if (!regionUsable) {
    const legacy = legacyNameStreet(bands);
    return { name: legacy.name, vorname: legacy.vorname, strasse: legacy.strasse, plz, ort };
  }

  // Name + Strasse sit ABOVE the PLZ/Ort line: [Name] / [Strasse] / [PLZ Ort].
  // Anchor on the PLZ band and read the content lines above it — robust against the
  // trilingual printed labels (which sit to the LEFT of each value) and unable to
  // ever pull the PLZ/Ort line in as the name (the "Vorname = Schwyz" failure).
  const upperBound = plzBandIdx >= 0 ? plzBandIdx : regionBands.length;
  const contentAbove: { toks: PWord[]; hasNumber: boolean }[] = [];
  for (let bi = 0; bi < upperBound; bi++) {
    const toks = valueAfterLabels(regionBands[bi].words, 5);
    if (!toks.some(isNameWordStrict)) continue; // need a real word (drops "123456")
    const joined = toks.map((w) => w.raw).join(' ').trim();
    if (/^\d{4}\b/.test(joined)) continue; // a stray PLZ line — not name/street
    contentAbove.push({ toks, hasNumber: /\d{1,4}[a-z]?\b/i.test(joined) });
  }

  if (contentAbove.length) {
    // The street is the band that carries a HOUSE NUMBER (a far stronger, less
    // surname-confusable signal than position: it stops "Zürcher / Beat" —
    // an OCR-split name — from making "Beat" the street). The name is the band(s)
    // above it, concatenated (a name split across two lines rejoins); with no
    // numbered band, ALL the content is the name.
    let streetIdx = -1;
    for (let k = contentAbove.length - 1; k >= 0; k--) {
      if (contentAbove[k].hasNumber) { streetIdx = k; break; }
    }
    if (streetIdx >= 0) {
      // Keep tokens up to and including the first house number so a trailing field-
      // number leak ("Rütimatt 5 17" → "Rütimatt 5") is dropped.
      const st: string[] = [];
      for (const w of contentAbove[streetIdx].toks) {
        st.push(w.raw);
        if (/\d/.test(w.raw)) break;
      }
      strasse = { value: st.join(' ').trim(), conf: meanConf(contentAbove[streetIdx].toks) };
    }
    const nameBands = streetIdx >= 0 ? contentAbove.slice(0, streetIdx) : contentAbove;
    const nameToks = nameBands.flatMap((b) => b.toks).slice(0, 4);
    if (nameToks.length) {
      const split = splitNameVorname(nameToks);
      name = split.name;
      vorname = split.vorname;
    }
  }

  return { vorname, name, strasse, plz, ort };
}

// ----------------------------------------------------------------------------
// Main entry
// ----------------------------------------------------------------------------

export function parseOcrWords(
  words: OcrWord[],
  imageWidth: number,
  imageHeight: number,
  country?: string,
): ParseOcrResult {
  const fields: ScanFields = {
    marke: null, modell: null, kennzeichen: null, fahrgestellnummer: null, stammnummer: null,
    farbe: null, erstzulassung: null, versicherung: null,
    halterVorname: null, halterName: null, halterStrasse: null, halterPlz: null, halterOrt: null,
  };
  const confidence: Partial<Record<keyof ScanFields, number>> = {};
  if (!words || !words.length) return { fields, confidence };

  const pwords = words
    .filter((w) => w && typeof w.text === 'string' && w.text.trim().length > 0 && w.bbox)
    .map(toPWord);
  const bands = groupBands(pwords);

  const set = (key: keyof ScanFields, hit: FieldHit | null, normed?: string | null) => {
    if (!hit) return;
    const v = normed !== undefined ? normed : hit.value;
    if (v == null || v === '') return;
    fields[key] = v;
    confidence[key] = Math.round(hit.conf);
  };

  // ── hard-format fields (pattern-first) ──────────────────────────────────
  // VIN sits on the SAME printed row as its label, at/right of it.
  const vinAnchorX = anchorColumns(bands, [...A.vin.labels], [...A.vin.numbers]);
  const vin = extractVin(bands, vinAnchorX);
  set('fahrgestellnummer', vin, vin ? normalizeVin(vin.value) ?? vin.value : null);

  const stamm = extractStammnummer(bands);
  set('stammnummer', stamm, stamm ? normalizeStammnummer(stamm.value) : null);

  const plate = extractPlate(bands);
  set('kennzeichen', plate, plate ? normalizePlate(plate.value) : null);

  set('erstzulassung', extractDate(bands));

  // ── dictionary / anchor fields ──────────────────────────────────────────
  const { make, model } = extractMakeModel(bands);
  set('marke', make);
  set('modell', model);
  set('farbe', extractColor(bands));
  set('versicherung', extractInsurance(bands));

  // ── Halter block (best effort) ──────────────────────────────────────────
  const h = extractHalter(bands, pwords, imageWidth, imageHeight, country);
  set('halterName', h.name);
  set('halterVorname', h.vorname);
  set('halterStrasse', h.strasse);
  set('halterPlz', h.plz);
  set('halterOrt', h.ort);

  return { fields, confidence };
}
