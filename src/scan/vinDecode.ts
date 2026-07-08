// ============================================================================
// vinDecode — OFFLINE, deterministic VIN → make + approx. model year decode.
// Decodes the World Manufacturer Identifier (WMI, chars 1–3) into a make and
// the model-year char (char 10) into an approximate model year — entirely
// offline, no external API, no LLM guessing. WMI hits are EXACT 3-char only (a
// miss returns no make rather than a wrong one). The model year is an
// APPROXIMATION, not the first registration.
// ============================================================================

import { normalizeVin } from './scanProviders';

export interface VinDecodeResult {
  make?: string;
  modelYear?: number;
  region?: string;
  wmi?: string;
}

// World Manufacturer Identifier (VIN chars 1–3) → canonical make. Seeded for
// makes sold in CH / DE / AT / AU. EXACT-hit only.
export const WMI_TABLE: Readonly<Record<string, string>> = {
  WVW: 'VW', WV1: 'VW', WV2: 'VW', WVG: 'VW', '1VW': 'VW', '3VW': 'VW', AAV: 'VW',
  WAU: 'Audi', WUA: 'Audi', WA1: 'Audi', TRU: 'Audi',
  WP0: 'Porsche', WP1: 'Porsche',
  VSS: 'Seat',
  TMB: 'Škoda', TMP: 'Škoda', TMK: 'Škoda',
  WBA: 'BMW', WBS: 'BMW', WBY: 'BMW', WBX: 'BMW',
  WMW: 'MINI',
  WDB: 'Mercedes-Benz', WDD: 'Mercedes-Benz', WDC: 'Mercedes-Benz', W1K: 'Mercedes-Benz',
  W1N: 'Mercedes-Benz', W1V: 'Mercedes-Benz', WDF: 'Mercedes-Benz',
  WME: 'Smart',
  VF1: 'Renault', VF2: 'Renault',
  UU1: 'Dacia',
  VF3: 'Peugeot',
  VF7: 'Citroën',
  VR1: 'DS',
  ZFA: 'Fiat', ZFC: 'Fiat',
  ZAR: 'Alfa Romeo',
  ZLA: 'Lancia',
  ZAM: 'Maserati',
  W0L: 'Opel', W0V: 'Opel',
  WF0: 'Ford', SFA: 'Ford',
  ZFF: 'Ferrari',
  ZHW: 'Lamborghini', ZPB: 'Lamborghini',
  VF9: 'Bugatti',
  SAJ: 'Jaguar',
  SAL: 'Land Rover',
  SCB: 'Bentley',
  SCA: 'Rolls-Royce',
  SCF: 'Aston Martin',
  SBM: 'McLaren',
  YV1: 'Volvo', YV4: 'Volvo',
  YS3: 'Saab',
  JTD: 'Toyota', JTE: 'Toyota', JTM: 'Toyota', JTN: 'Toyota', SB1: 'Toyota',
  VNK: 'Toyota', NMT: 'Toyota', MR0: 'Toyota',
  JTH: 'Lexus', JTJ: 'Lexus',
  JHM: 'Honda', JHL: 'Honda', SHH: 'Honda',
  JN1: 'Nissan', SJN: 'Nissan', VSK: 'Nissan',
  JMZ: 'Mazda', JM1: 'Mazda', JM0: 'Mazda',
  JMB: 'Mitsubishi', MMB: 'Mitsubishi', MMT: 'Mitsubishi',
  JF1: 'Subaru', JF2: 'Subaru',
  JS2: 'Suzuki', JS3: 'Suzuki', TSM: 'Suzuki',
  JDA: 'Daihatsu',
  JAA: 'Isuzu', JAB: 'Isuzu', JAL: 'Isuzu',
  KMH: 'Hyundai', KM8: 'Hyundai', TMA: 'Hyundai', NLH: 'Hyundai',
  KNA: 'Kia', KND: 'Kia', KNE: 'Kia', U5Y: 'Kia',
  '5YJ': 'Tesla', LRW: 'Tesla',
  KL1: 'Chevrolet', '1G1': 'Chevrolet',
  '1C4': 'Jeep', ZAC: 'Jeep',
  '1B3': 'Dodge', '1D7': 'Dodge',
  '1C3': 'Chrysler', '2C3': 'Chrysler',
  '1G6': 'Cadillac',
  LSJ: 'MG',
};

// Model-year letters for VIN char 10 (NHTSA 30-year cycle), excluding I,O,Q,U,Z.
const YEAR_LETTERS = 'ABCDEFGHJKLMNPRSTVWXY';

export function decodeModelYear(yearChar: string): number | undefined {
  if (!yearChar) return undefined;
  const c = String(yearChar).toUpperCase();
  let year: number;
  if (/^[1-9]$/.test(c)) {
    year = 2000 + parseInt(c, 10);
  } else {
    const idx = YEAR_LETTERS.indexOf(c);
    if (idx < 0) return undefined;
    year = 2010 + idx;
  }
  const currentYear = new Date().getFullYear();
  if (year > currentYear + 1) year -= 30;
  return year;
}

function vinRegion(firstChar: string): string | undefined {
  const c = (firstChar || '').toUpperCase();
  if (c >= 'A' && c <= 'H') return 'Africa';
  if (c >= 'J' && c <= 'R') return 'Asia';
  if (c >= 'S' && c <= 'Z') return 'Europe';
  if (c >= '1' && c <= '5') return 'North America';
  if (c >= '6' && c <= '7') return 'Oceania';
  if (c >= '8' && c <= '9') return 'South America';
  return undefined;
}

/** Decode a VIN to make + approximate model year, fully offline. Returns {} for
 *  a VIN that fails normalizeVin. A WMI not in WMI_TABLE leaves make undefined. */
export function decodeVin(vin: string | null | undefined): VinDecodeResult {
  const norm = normalizeVin(vin);
  if (!norm) return {};
  const wmi = norm.slice(0, 3);
  const result: VinDecodeResult = { wmi };
  const make = WMI_TABLE[wmi];
  if (make) result.make = make;
  const modelYear = decodeModelYear(norm[9]);
  if (modelYear) result.modelYear = modelYear;
  const region = vinRegion(norm[0]);
  if (region) result.region = region;
  return result;
}
