// ============================================================================
// Vehicle Document Scanner — client orchestrator
// ----------------------------------------------------------------------------
// Renderer-side entry point. Sends the BYO key + captured image through the
// bridgeFetch seam to the transport (Electron IPC / Android CapacitorHttp),
// which POSTs directly to the provider and returns the RAW provider JSON. Here
// we parse that envelope, normalise VIN / plate / Stammnummer, and hand back
// canonical fields (vehicle + Halter) for the confirm-and-edit step.
// ============================================================================

import { bridgeFetch } from '../platform/apiBridge';
import {
  parseScanResponse,
  parseVinScanResponse,
  sanitizeScanFields,
  normalizeVin,
  normalizePlate,
  normalizeStammnummer,
  type ScanProvider,
  type ScanKind,
} from './scanProviders';
import { decodeVin } from './vinDecode';

export type ScanErrorCode = 'auth' | 'transport' | 'parse';

/** Canonical result mapped onto the job-card field names (vehicle + Halter). */
export interface ScanResult {
  make: string | null;
  model: string | null;
  licensePlate: string | null;
  chassisNr: string | null;
  stammnummer: string | null;
  color: string | null;
  erstzulassung: string | null;
  insurance: string | null;
  halterVorname: string | null;
  halterName: string | null;
  halterStrasse: string | null;
  halterPlz: string | null;
  halterOrt: string | null;
  /** True when the post-parse validator nulled/flagged a field. */
  lowConfidence?: boolean;
}

export interface ScanInput {
  provider: ScanProvider;
  apiKey: string;
  imageBase64: string;
  mimeType: string;
  country?: string;
  accountId?: string;
  scanKind?: ScanKind;
}

export function makeScanError(code: ScanErrorCode, message?: string): Error {
  const e = new Error(message || code) as Error & { code: ScanErrorCode };
  e.code = code;
  return e;
}

export function emptyScanResult(): ScanResult {
  return {
    make: null, model: null, licensePlate: null, chassisNr: null, stammnummer: null,
    color: null, erstzulassung: null, insurance: null,
    halterVorname: null, halterName: null, halterStrasse: null, halterPlz: null, halterOrt: null,
  };
}

/** True if every extracted field came back empty. */
export function isEmptyScanResult(r: ScanResult): boolean {
  return (
    !r.make && !r.model && !r.licensePlate && !r.chassisNr && !r.stammnummer &&
    !r.color && !r.erstzulassung && !r.insurance &&
    !r.halterVorname && !r.halterName && !r.halterStrasse && !r.halterPlz && !r.halterOrt
  );
}

function vinForDisplay(raw: string | null): string | null {
  const norm = normalizeVin(raw);
  if (norm) return norm;
  if (!raw) return null;
  const cleaned = raw.toUpperCase().replace(/\s+/g, '');
  return /^[A-Z0-9]{8,20}$/.test(cleaned) ? cleaned : null;
}

export async function scanDocument(input: ScanInput): Promise<ScanResult> {
  const { provider, apiKey, imageBase64, mimeType, country, accountId, scanKind = 'fahrzeugausweis' } = input;
  if (!apiKey) throw makeScanError('auth', 'missing key');
  if (!imageBase64) throw makeScanError('transport', 'missing image');

  let res: Response;
  try {
    res = await bridgeFetch('/api/scan-document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, apiKey, imageBase64, mimeType, country, accountId, scanKind }),
    });
  } catch (e) {
    throw makeScanError('transport', e instanceof Error ? e.message : String(e));
  }

  if (res.status === 401 || res.status === 403) {
    throw makeScanError('auth', `provider auth ${res.status}`);
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw makeScanError('parse', 'non-json response');
  }

  const errObj = (raw as { error?: unknown })?.error;
  if (!res.ok || errObj) {
    const msg =
      errObj && typeof errObj === 'object'
        ? String((errObj as { message?: unknown }).message || '')
        : String(errObj || '');
    const looksAuth =
      res.status === 401 ||
      res.status === 403 ||
      /api[_ ]?key|unauthorized|invalid.*key|authentication|x-api-key/i.test(msg);
    throw makeScanError(looksAuth ? 'auth' : 'transport', msg || `status ${res.status}`);
  }

  // ── VIN mode: 2-field read + OFFLINE make/year decode ──────────────────────
  if (scanKind === 'vin') {
    const vinFields = parseVinScanResponse(provider, raw);
    const vin = vinForDisplay(vinFields.vin);
    const decoded = decodeVin(vinFields.vin);
    const plate = sanitizeScanFields({
      marke: null, modell: null, kennzeichen: vinFields.kennzeichen, fahrgestellnummer: null,
      stammnummer: null, farbe: null, erstzulassung: null, versicherung: null,
      halterVorname: null, halterName: null, halterStrasse: null, halterPlz: null, halterOrt: null,
    }).kennzeichen;
    return {
      ...emptyScanResult(),
      make: decoded.make ?? null,
      licensePlate: normalizePlate(plate),
      chassisNr: vin,
      erstzulassung: decoded.modelYear ? String(decoded.modelYear) : null,
      lowConfidence: !normalizeVin(vinFields.vin),
    };
  }

  const parsed = parseScanResponse(provider, raw);
  const fields = sanitizeScanFields(parsed);
  return {
    make: fields.marke,
    model: fields.modell,
    licensePlate: normalizePlate(fields.kennzeichen),
    chassisNr: vinForDisplay(fields.fahrgestellnummer),
    stammnummer: normalizeStammnummer(fields.stammnummer),
    color: fields.farbe,
    erstzulassung: fields.erstzulassung,
    insurance: fields.versicherung,
    halterVorname: fields.halterVorname,
    halterName: fields.halterName,
    halterStrasse: fields.halterStrasse,
    halterPlz: fields.halterPlz,
    halterOrt: fields.halterOrt,
    lowConfidence: fields.droppedFields.length > 0,
  };
}
