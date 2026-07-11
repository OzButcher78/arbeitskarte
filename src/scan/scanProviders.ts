// ============================================================================
// Vehicle Document Scanner — shared, pure provider module
// ----------------------------------------------------------------------------
// Dependency-free (no DOM, no Node-only imports). Imported by THREE call sites
// that must agree on the wire format AND the extraction contract:
//   • the Electron main-process IPC handler  (electron/ipc/scan.ts)
//   • the Android CapacitorHttp branch       (src/platform/apiBridge.ts)
//   • the client orchestrator                (src/scan/documentScanner.ts)
//
//   buildScanRequest()  — TRANSPORT side. Turns the BYO key + image into the
//     exact per-provider REST request. The key only ever lives in the returned
//     headers, in the process that makes the call. Never persisted, never logged.
//   parseScanResponse() + normalizeVin/normalizePlate() — CLIENT side. Pull the
//     model's strict-JSON envelope out of the raw response and canonicalise.
//
// EXTRACTION SCOPE (Arbeitskarte): unlike the source app's vehicle-only schema,
// this reads BOTH the vehicle fields AND the owner (Halter) block + the Swiss
// Stammnummer — the workshop transfers those to the job card. Because owner PII
// therefore leaves the device towards the chosen OCR provider, the settings
// compliance acknowledgement must say so (BYO key + provider DPA). A
// policy/contract/insurance-certificate NUMBER is still never extracted.
//
// PROVIDERS & DATA RESIDENCY:
//   • infomaniak — Switzerland-hosted, OpenAI-compatible. CH residency; default.
//   • mistral    — EU/France-hosted, OpenAI-compatible. EU residency.
//   • openai / anthropic — US providers, behind a cross-border-transfer gate.
// ============================================================================

export type ScanProvider = 'openai' | 'anthropic' | 'infomaniak' | 'mistral';

/** Provider the SCANNER UI may pick. `'local'` is the on-device Tesseract OCR
 *  path — it is deliberately NOT part of `ScanProvider` (the exhaustively-typed
 *  HTTP transport: SCAN_PROVIDER_META / SCAN_MODELS / buildScanRequest never see
 *  it). Only the client orchestrator + UI branch on this wider type. */
export type ScanProviderChoice = ScanProvider | 'local';

/** What the scan reads. 'fahrzeugausweis' = registration document; 'vin' = a
 *  VIN plate on a car part (2-field read + offline decode). */
export type ScanKind = 'fahrzeugausweis' | 'vin';

/** Where the provider processes the image — drives the UI transfer warning. */
export type ScanProviderRegion = 'CH' | 'EU' | 'US';

export interface ScanProviderMeta {
  region: ScanProviderRegion;
  label: string;
  dpaUrl: string;
  requiresAccountId?: boolean;
}

export const SCAN_PROVIDER_META: Record<ScanProvider, ScanProviderMeta> = {
  infomaniak: {
    region: 'CH',
    label: 'Infomaniak (Schweiz)',
    dpaUrl: 'https://manager.infomaniak.com/v3/ng/group-settings/certificate-rgpd',
    requiresAccountId: true,
  },
  mistral: {
    region: 'EU',
    label: 'Mistral AI (EU / Frankreich)',
    dpaUrl: 'https://mistral.ai/terms/#data-processing-agreement',
  },
  openai: {
    region: 'US',
    label: 'OpenAI (USA)',
    dpaUrl: 'https://openai.com/policies/data-processing-addendum/',
  },
  anthropic: {
    region: 'US',
    label: 'Anthropic (USA)',
    dpaUrl: 'https://www.anthropic.com/legal/commercial-terms',
  },
};

/** Coerce an untrusted transport value to a known provider (default infomaniak
 *  — the Swiss default; never silently a US provider). */
export function coerceScanProvider(value: unknown): ScanProvider {
  return value === 'anthropic' || value === 'openai' || value === 'mistral'
    ? value
    : 'infomaniak';
}

export interface ScanComplianceAck {
  dpa?: boolean;
  transfer?: boolean;
}

/**
 * Complete extraction result. Vehicle fields + the Swiss Stammnummer + the
 * owner (Halter) name/address. NO policy/contract/insurance-certificate number.
 */
export interface ScanFields {
  // Fahrzeug
  marke: string | null;
  modell: string | null;
  kennzeichen: string | null;
  fahrgestellnummer: string | null;
  stammnummer: string | null;
  farbe: string | null;
  erstzulassung: string | null;
  versicherung: string | null;
  // Halter (owner)
  halterVorname: string | null;
  halterName: string | null;
  halterStrasse: string | null;
  halterPlz: string | null;
  halterOrt: string | null;
}

export const SCAN_FIELD_KEYS: ReadonlyArray<keyof ScanFields> = [
  'marke',
  'modell',
  'kennzeichen',
  'fahrgestellnummer',
  'stammnummer',
  'farbe',
  'erstzulassung',
  'versicherung',
  'halterVorname',
  'halterName',
  'halterStrasse',
  'halterPlz',
  'halterOrt',
];

// Vision model names kept in ONE place (provider-drift mitigation).
export const SCAN_MODELS: Record<ScanProvider, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-3-5-sonnet-latest',
  infomaniak: 'mistralai/Ministral-3-14B-Instruct-2512',
  mistral: 'mistral-small-latest',
};

const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 800;

export interface ScanRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

// ----------------------------------------------------------------------------
// Extraction prompt + JSON contract (vehicle + Halter block + Stammnummer)
// ----------------------------------------------------------------------------

export const PROMPT = `You are a precise data-extraction engine for European vehicle registration documents (Swiss "Fahrzeugausweis", German "Zulassungsbescheinigung Teil I", French "carte grise", Italian "libretto di circolazione").

Return STRICT JSON with EXACTLY these thirteen keys and no others:
{"marke":string|null,"modell":string|null,"kennzeichen":string|null,"fahrgestellnummer":string|null,"stammnummer":string|null,"farbe":string|null,"erstzulassung":string|null,"versicherung":string|null,"halterVorname":string|null,"halterName":string|null,"halterStrasse":string|null,"halterPlz":string|null,"halterOrt":string|null}

ABSOLUTE RULE — DO NOT GUESS:
- Extract ONLY values you can clearly READ on the document. If a field is absent, unreadable, blurry, masked, or you are not certain, output null for that field.
- NEVER invent, infer, or guess a value. An empty (null) field is ALWAYS better than a wrong one.
- NEVER output a field label, a code letter, a heading, or a description as a value (e.g. do not output "Marke", "Farbe", "Code D.1", "Halter").
- Output each value EXACTLY as printed (do not translate or normalise it).

FIELD-CONFUSION GUARDS — every value MUST match its field's type:
- "marke" is a vehicle MANUFACTURER (e.g. "Mercedes-Benz", "VW", "BMW"). A colour, a date, or a number is NEVER a make.
- "farbe" is a COLOUR word (e.g. "Schwarz", "Silbergrau"). A manufacturer or a description is NEVER a colour.
- "versicherung" is an insurance COMPANY name (e.g. "AXA", "Zürich", "Die Mobiliar", "Helvetia", "Baloise", "Vaudoise"). A number is NEVER an insurer.
- "kennzeichen" is a registration plate (letters + digits, e.g. "SZ 35663").
- "fahrgestellnummer" is a 17-character VIN (letters A-HJ-NPR-Z and digits 0-9).
- "stammnummer" is the Swiss "Stammnummer" — a 9-digit number usually printed as "123.456.789". It is DIFFERENT from the 17-character VIN. Non-Swiss documents have no Stammnummer → null.
- "erstzulassung" is a DATE of first registration (contains a year).

Field sources (EU harmonised letter codes appear on most documents):
- "marke": make — code D.1 (or the manufacturer part of the Swiss "Marke und Typ" line).
- "modell": model / type — code D.3 (or the rest of "Marke und Typ" after the manufacturer).
- "kennzeichen": plate — "Kennzeichen" / "Kontrollschild" / "Immatriculation".
- "fahrgestellnummer": VIN — code E (17 characters).
- "stammnummer": Swiss "Stammnummer" (9 digits, e.g. 123.456.789).
- "farbe": colour — code R / "Farbe" / "Couleur".
- "erstzulassung": first registration — code B / "1. Inverkehrsetzung" / "1ère mise en circulation". Keep the document's own date format.
- "versicherung": the insurer's COMPANY name only. Never a policy/contract/certificate number. If unreadable, output null.

OWNER (HALTER) BLOCK — read the vehicle keeper's name and address from the Halter block (Swiss codes C / "Halter"; EU codes C.1.1 name, C.1.3 address):
- "halterName": the keeper's family name, OR the company name if the keeper is a business.
- "halterVorname": the keeper's first name(s). Null for a company.
- "halterStrasse": the keeper's street and house number.
- "halterPlz": the keeper's postal code (4 digits in Switzerland).
- "halterOrt": the keeper's town / city.

MANDATORY:
- NEVER output a policy number, contract number, or insurance certificate number in any field.
- Swiss documents merge make and type into one "Marke und Typ" line — split it: manufacturer to "marke", the rest to "modell".
- Output ONLY the raw JSON object. No explanation, no markdown, no code fences.`;

export const VIN_PROMPT = `You are a precise VIN reader. The image is a photo of a car part showing the Vehicle Identification Number (VIN / Fahrgestellnummer): a windshield VIN plate, a door-jamb sticker, an engine-bay plate, or a dashboard etching. It is NOT a registration document.

Return STRICT JSON with EXACTLY these two keys and no others:
{"vin":string|null,"kennzeichen":string|null}

- "vin": the 17-character VIN. It uses ONLY characters A-H, J-N, P, R-Z and 0-9 (the letters I, O and Q never appear). Read all 17 characters exactly. If you cannot read all 17 clearly, output null. Do NOT guess missing characters.
- "kennzeichen": the licence plate, ONLY if clearly visible in the same photo; else null.

ABSOLUTE RULES:
- Extract ONLY what you can clearly read. Never invent or guess characters.
- Output ONLY the raw JSON object. No explanation, no markdown, no code fences.`;

// ----------------------------------------------------------------------------
// buildScanRequest — per-provider REST request (TRANSPORT side)
// ----------------------------------------------------------------------------

function bareBase64(image: string): string {
  const marker = 'base64,';
  const i = image.indexOf(marker);
  return i >= 0 ? image.slice(i + marker.length) : image;
}

function countryHint(country?: string): string {
  const c = (country || '').trim();
  return c ? `\n\nThe document is from this country/region: ${c}.` : '';
}

export function buildScanRequest(
  provider: ScanProvider,
  apiKey: string,
  imageBase64: string,
  mimeType: string,
  country?: string,
  accountId?: string,
  scanKind: ScanKind = 'fahrzeugausweis',
): ScanRequest {
  const b64 = bareBase64(imageBase64);
  const mime = mimeType || 'image/jpeg';
  const isVin = scanKind === 'vin';
  const promptText = isVin ? VIN_PROMPT : PROMPT;
  const userText = isVin
    ? `Read the 17-character VIN (Fahrgestellnummer) from this photo of a car part as strict JSON.${countryHint(country)}`
    : `Extract the vehicle fields, the Stammnummer and the owner (Halter) block from this registration document as strict JSON.${countryHint(country)}`;

  if (provider === 'anthropic') {
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: {
        model: SCAN_MODELS.anthropic,
        max_tokens: MAX_TOKENS,
        temperature: 0,
        system: promptText,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
              { type: 'text', text: userText },
            ],
          },
        ],
      },
    };
  }

  // OpenAI-compatible: openai (US), infomaniak (CH), mistral (EU).
  const dataUrl = `data:${mime};base64,${b64}`;
  const imagePart =
    provider === 'mistral'
      ? { type: 'image_url', image_url: dataUrl }
      : { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } };
  const body: Record<string, unknown> = {
    model: SCAN_MODELS[provider],
    max_tokens: MAX_TOKENS,
    temperature: 0,
    messages: [
      { role: 'system', content: promptText },
      { role: 'user', content: [{ type: 'text', text: userText }, imagePart] },
    ],
  };
  // Infomaniak's vLLM host rejects response_format with HTTP 400; the prompt +
  // parser handle raw JSON, so we only force JSON-mode on providers that accept it.
  if (provider !== 'infomaniak') {
    body.response_format = { type: 'json_object' };
  }

  let url: string;
  if (provider === 'infomaniak') {
    url = `https://api.infomaniak.com/2/ai/${encodeURIComponent((accountId || '').trim())}/openai/v1/chat/completions`;
  } else if (provider === 'mistral') {
    url = 'https://api.mistral.ai/v1/chat/completions';
  } else {
    url = 'https://api.openai.com/v1/chat/completions';
  }

  return {
    url,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body,
  };
}

// ----------------------------------------------------------------------------
// parseScanResponse — extract the model's JSON envelope (CLIENT side)
// ----------------------------------------------------------------------------

function extractEnvelopeText(provider: ScanProvider, raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  if (provider === 'anthropic') {
    const content = r.content;
    if (Array.isArray(content)) {
      const textPart = content.find((p: any) => p && p.type === 'text' && typeof p.text === 'string');
      if (textPart) return textPart.text as string;
    }
    return null;
  }
  const msg = r.choices?.[0]?.message?.content;
  return typeof msg === 'string' ? msg : null;
}

function stripCodeFences(s: string): string {
  const t = s.trim();
  const fenced = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : t;
}

function cleanField(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^\*+$/.test(s)) return null;
  const lower = s.toLowerCase();
  if (lower === 'null' || lower === 'n/a' || lower === 'unbekannt') return null;
  return s;
}

function emptyScanFields(): ScanFields {
  return {
    marke: null, modell: null, kennzeichen: null, fahrgestellnummer: null, stammnummer: null,
    farbe: null, erstzulassung: null, versicherung: null,
    halterVorname: null, halterName: null, halterStrasse: null, halterPlz: null, halterOrt: null,
  };
}

export function parseScanResponse(provider: ScanProvider, raw: unknown): ScanFields {
  const text = extractEnvelopeText(provider, raw);
  if (!text) return emptyScanFields();

  let obj: Record<string, unknown>;
  try {
    const parsed = JSON.parse(stripCodeFences(text));
    if (!parsed || typeof parsed !== 'object') return emptyScanFields();
    obj = parsed as Record<string, unknown>;
  } catch {
    return emptyScanFields();
  }

  // STRICT subset: only ever read the whitelisted keys.
  return {
    marke: cleanField(obj.marke),
    modell: cleanField(obj.modell),
    kennzeichen: cleanField(obj.kennzeichen),
    fahrgestellnummer: cleanField(obj.fahrgestellnummer),
    stammnummer: cleanField(obj.stammnummer),
    farbe: cleanField(obj.farbe),
    erstzulassung: cleanField(obj.erstzulassung),
    versicherung: cleanField(obj.versicherung),
    halterVorname: cleanField(obj.halterVorname),
    halterName: cleanField(obj.halterName),
    halterStrasse: cleanField(obj.halterStrasse),
    halterPlz: cleanField(obj.halterPlz),
    halterOrt: cleanField(obj.halterOrt),
  };
}

export interface VinScanFields {
  vin: string | null;
  kennzeichen: string | null;
}

export function parseVinScanResponse(provider: ScanProvider, raw: unknown): VinScanFields {
  const empty: VinScanFields = { vin: null, kennzeichen: null };
  const text = extractEnvelopeText(provider, raw);
  if (!text) return empty;

  let obj: Record<string, unknown>;
  try {
    const parsed = JSON.parse(stripCodeFences(text));
    if (!parsed || typeof parsed !== 'object') return empty;
    obj = parsed as Record<string, unknown>;
  } catch {
    return empty;
  }

  return { vin: cleanField(obj.vin), kennzeichen: cleanField(obj.kennzeichen) };
}

// ----------------------------------------------------------------------------
// Normalisers (CLIENT side)
// ----------------------------------------------------------------------------

/** Canonicalise a VIN: 17 chars, charset A–Z0–9 minus I/O/Q (auto-corrected
 *  I→1, O→0, Q→0). Returns null for masked / wrong-length input. */
export function normalizeVin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).toUpperCase().replace(/\s+/g, '');
  if (!s || s.includes('*')) return null;
  if (s.length === 18 && s[0] === 'I') s = s.slice(1);
  s = s.replace(/I/g, '1').replace(/O/g, '0').replace(/Q/g, '0');
  if (s.length !== 17) return null;
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(s)) return null;
  return s;
}

/** Canonicalise a licence plate: uppercase, collapse whitespace, trim. */
export function normalizePlate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).toUpperCase().replace(/\s+/g, ' ').trim();
  if (!s || /^\*+$/.test(s)) return null;
  return s;
}

/** Canonicalise a Swiss Stammnummer to "123.456.789" when it is 9 digits;
 *  otherwise return the trimmed input (or null). */
export function normalizeStammnummer(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s || /^\*+$/.test(s)) return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length === 9) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}`;
  }
  return s;
}

// ----------------------------------------------------------------------------
// Semantic field validator (CLIENT side, pure) — POST-PARSE anti-hallucination
// ----------------------------------------------------------------------------

/** Normalise a free-text value for table lookup. */
export function normForLookup(s: string): string {
  let t = String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  t = t.replace(/\b(metallic|met\.?|perl(mutt)?|uni)\b/g, ' ').replace(/\s+/g, ' ').trim();
  return t;
}

const RAW_COLORS = [
  'Schwarz', 'Weiss', 'Weiß', 'Grau', 'Silber', 'Silbergrau', 'Anthrazit', 'Blau',
  'Dunkelblau', 'Hellblau', 'Rot', 'Dunkelrot', 'Weinrot', 'Grün', 'Dunkelgrün',
  'Hellgrün', 'Gelb', 'Orange', 'Braun', 'Beige', 'Gold', 'Bronze', 'Violett', 'Lila',
  'Türkis', 'Creme', 'Rosa',
  'Noir', 'Blanc', 'Gris', 'Argent', 'Argenté', 'Bleu', 'Rouge', 'Vert', 'Jaune',
  'Brun', 'Marron', 'Doré', 'Or', 'Violet', 'Turquoise', 'Bordeaux',
  'Nero', 'Bianco', 'Grigio', 'Argento', 'Blu', 'Azzurro', 'Rosso', 'Verde', 'Giallo',
  'Arancione', 'Marrone', 'Oro', 'Viola', 'Turchese',
  'Black', 'White', 'Grey', 'Gray', 'Silver', 'Blue', 'Red', 'Green', 'Yellow',
  'Brown', 'Beige', 'Bronze', 'Purple', 'Maroon',
];
export const KNOWN_COLORS: ReadonlySet<string> = new Set(RAW_COLORS.map(normForLookup));

const MAKE_ALIASES: ReadonlyArray<[string, string[]]> = [
  ['VW', ['vw', 'volkswagen']],
  ['Audi', ['audi']],
  ['BMW', ['bmw']],
  ['Mercedes-Benz', ['mercedes', 'mercedes-benz', 'mercedes benz', 'mercedesbenz', 'benz']],
  ['Porsche', ['porsche']],
  ['Opel', ['opel']],
  ['Ford', ['ford']],
  ['Seat', ['seat']],
  ['Cupra', ['cupra']],
  ['Škoda', ['skoda', 'škoda']],
  ['Renault', ['renault']],
  ['Dacia', ['dacia']],
  ['Peugeot', ['peugeot']],
  ['Citroën', ['citroen', 'citroën']],
  ['Fiat', ['fiat']],
  ['Alfa Romeo', ['alfa romeo', 'alfaromeo', 'alfa']],
  ['Toyota', ['toyota']],
  ['Lexus', ['lexus']],
  ['Honda', ['honda']],
  ['Nissan', ['nissan']],
  ['Mazda', ['mazda']],
  ['Mitsubishi', ['mitsubishi']],
  ['Subaru', ['subaru']],
  ['Suzuki', ['suzuki']],
  ['Hyundai', ['hyundai']],
  ['Kia', ['kia']],
  ['Volvo', ['volvo']],
  ['MINI', ['mini']],
  ['Smart', ['smart']],
  ['Tesla', ['tesla']],
  ['Jeep', ['jeep']],
  ['Land Rover', ['land rover', 'landrover']],
  ['Jaguar', ['jaguar']],
];
export const KNOWN_MAKES: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [canonical, aliases] of MAKE_ALIASES) {
    m.set(normForLookup(canonical), canonical);
    for (const a of aliases) m.set(normForLookup(a), canonical);
  }
  return m;
})();

const LABEL_ECHOES_MARKE = new Set(
  ['marke', 'make', 'manufacturer', 'hersteller', 'marque', 'marca'].map(normForLookup),
);
const LABEL_ECHOES_MODELL = new Set(['modell', 'model', 'typ', 'type', 'modele', 'modello'].map(normForLookup));
const VERSICHERUNG_SUBSTRING_BLOCK = ['farbe', 'colour', 'fahrzeug', 'vehicle', 'reifen', 'wheel', 'siehe'];
const VERSICHERUNG_WORD_BLOCK = ['rad', 'rader', 'tyre', 'tire', 'color', 'keine', 'none'];
const VERSICHERUNG_WORD_BLOCK_RE = new RegExp('\\b(' + VERSICHERUNG_WORD_BLOCK.join('|') + ')\\b');

export interface SanitizedScanFields extends ScanFields {
  droppedFields: (keyof ScanFields)[];
}

/**
 * Semantically validate a parsed scan result. Conservative: NULL a value only
 * when it clearly belongs to a different field type; otherwise keep it (flagging
 * unknown-but-plausible values so the confirm UI prompts a re-check). VIN + the
 * Halter free-text fields are left untouched (no reliable validator for names).
 */
export function sanitizeScanFields(fields: ScanFields): SanitizedScanFields {
  const out: ScanFields = { ...fields };
  const dropped: (keyof ScanFields)[] = [];
  const flag = (k: keyof ScanFields) => { if (!dropped.includes(k)) dropped.push(k); };
  const drop = (k: keyof ScanFields) => { out[k] = null; flag(k); };

  if (out.kennzeichen) {
    const p = String(out.kennzeichen).toUpperCase().replace(/\s+/g, ' ').trim();
    const okCharset = /^[A-ZÄÖÜ0-9 -]+$/.test(p);
    const hasLetter = /[A-ZÄÖÜ]/.test(p);
    const hasDigit = /[0-9]/.test(p);
    if (!okCharset || p.length < 2 || p.length > 12 || !hasLetter || !hasDigit) {
      drop('kennzeichen');
    } else {
      out.kennzeichen = p;
    }
  }

  if (out.farbe) {
    const norm = normForLookup(out.farbe);
    if (KNOWN_MAKES.has(norm)) {
      drop('farbe');
    } else if (!KNOWN_COLORS.has(norm)) {
      flag('farbe');
    }
  }

  if (out.marke) {
    const norm = normForLookup(out.marke);
    const canonical = KNOWN_MAKES.get(norm);
    if (canonical) {
      out.marke = canonical;
    } else if (KNOWN_COLORS.has(norm)) {
      drop('marke');
    } else if (LABEL_ECHOES_MARKE.has(norm)) {
      drop('marke');
    } else {
      flag('marke');
    }
  }

  if (out.modell && LABEL_ECHOES_MODELL.has(normForLookup(out.modell))) {
    drop('modell');
  }

  if (out.erstzulassung) {
    const s = String(out.erstzulassung);
    const yearMatch = s.match(/\b(19|20)\d{2}\b/);
    const currentYear = new Date().getFullYear();
    const yearOk = !!yearMatch && (() => {
      const y = parseInt(yearMatch[0], 10);
      return y >= 1900 && y <= currentYear + 1;
    })();
    const hasDate = /\b\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}\b/.test(s) || /\b\d{1,2}[.\/]\d{2,4}\b/.test(s);
    if (!yearOk && !hasDate) drop('erstzulassung');
  }

  if (out.versicherung) {
    const raw = String(out.versicherung).trim();
    const norm = normForLookup(raw);
    const isColorOrMake = KNOWN_COLORS.has(norm) || KNOWN_MAKES.has(norm);
    const hasBlockword =
      VERSICHERUNG_SUBSTRING_BLOCK.some((w) => norm.includes(w)) || VERSICHERUNG_WORD_BLOCK_RE.test(norm);
    const allDigits = /^[0-9]+$/.test(norm.replace(/\s+/g, ''));
    if (isColorOrMake || hasBlockword || allDigits || raw.length < 2) drop('versicherung');
  }

  return { ...out, droppedFields: dropped };
}
