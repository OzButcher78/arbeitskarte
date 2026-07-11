// ============================================================================
// OCR accuracy spike runner.  `npm run spike:ocr`
// ----------------------------------------------------------------------------
// For every samples/*.{jpg,jpeg,png,webp} that has a sibling *.expected.json
// (13-key ScanFields ground truth), run Tesseract over each preprocessing
// variant × page-seg mode, feed the words through the SHARED app parser
// (src/scan/localOcr/parseOcrWords.ts), and score the extraction against the
// expected values (both sides canonicalised by the SAME normalisers the app
// uses). Prints a per-config leaderboard, a per-field accuracy table for the
// winning config, and a PASS/FAIL against the Phase-A gate.
//
// The samples themselves are real registration documents (PII) and are
// gitignored — the user drops the 4 photos + expected JSON in locally.
// ============================================================================

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { recognize, terminateAll, PSM } from './engineNode.ts';
import { buildVariants } from './variants.ts';
import { parseOcrWords } from '../../src/scan/localOcr/parseOcrWords.ts';
import type { ScanFields } from '../../src/scan/scanProviders.ts';
import {
  normalizeVin,
  normalizePlate,
  normalizeStammnummer,
  normForLookup,
  KNOWN_MAKES,
} from '../../src/scan/scanProviders.ts';

const DIR = dirname(fileURLToPath(import.meta.url));
const SAMPLES = join(DIR, 'samples');
const LANG_PATH = join(DIR, 'tessdata');

const FIELDS: (keyof ScanFields)[] = [
  'marke', 'modell', 'kennzeichen', 'fahrgestellnummer', 'stammnummer', 'farbe',
  'erstzulassung', 'versicherung', 'halterVorname', 'halterName', 'halterStrasse',
  'halterPlz', 'halterOrt',
];
const HARD: (keyof ScanFields)[] = ['fahrgestellnummer', 'kennzeichen', 'stammnummer', 'erstzulassung'];

// Gate thresholds (per plan). Overridable via env for exploration.
const GATE_HARD = Number(process.env.SPIKE_GATE_HARD ?? 0.9);
const GATE_OVERALL = Number(process.env.SPIKE_GATE_OVERALL ?? 0.7);
const GATE_MS = Number(process.env.SPIKE_GATE_MS ?? 15000);

const ALL_PSM: PSM[] = [PSM.AUTO, PSM.SINGLE_COLUMN, PSM.SINGLE_BLOCK, PSM.SPARSE_TEXT]; // 3,4,6,11
function psmList(): PSM[] {
  const raw = process.env.SPIKE_PSM?.trim();
  if (!raw) return ALL_PSM;
  const want = new Set(raw.split(',').map((s) => s.trim()));
  return ALL_PSM.filter((p) => want.has(String(p)));
}

// ── canonicalisation: compare expected vs actual on equal footing ───────────
function digits(s: string): string {
  return s.replace(/\D/g, '');
}
function canonDate(s: string): string {
  const m = s.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
  if (m) {
    let y = m[3];
    if (y.length === 2) y = (Number(y) > 50 ? '19' : '20') + y;
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  const yr = s.match(/\b(19|20)\d{2}\b/);
  return yr ? yr[0] : normForLookup(s);
}
function canonMake(s: string): string {
  const n = normForLookup(s);
  return KNOWN_MAKES.get(n) ? normForLookup(KNOWN_MAKES.get(n)!) : n;
}
function canon(field: keyof ScanFields, value: string): string {
  switch (field) {
    case 'fahrgestellnummer': return normalizeVin(value) ?? value.toUpperCase().replace(/\s+/g, '');
    case 'kennzeichen': return (normalizePlate(value) ?? value).replace(/\s+/g, '').toUpperCase();
    case 'stammnummer': return digits(normalizeStammnummer(value) ?? value);
    case 'halterPlz': return digits(value);
    case 'erstzulassung': return canonDate(value);
    case 'marke': return canonMake(value);
    default: return normForLookup(value);
  }
}

type Cell = 'ok' | 'bad' | 'miss' | 'na';
function compareField(field: keyof ScanFields, expected: string | null, actual: string | null): Cell {
  if (expected == null || expected === '') return 'na';
  if (actual == null || actual === '') return 'miss';
  return canon(field, expected) === canon(field, actual) ? 'ok' : 'bad';
}

interface SampleRun {
  sample: string;
  fields: ScanFields;
  cells: Record<string, Cell>;
  ms: number;
  ok: number;
  expected: number;
  hardOk: number;
  hardExpected: number;
}

interface ConfigAgg {
  key: string;
  variant: string;
  psm: PSM;
  runs: SampleRun[];
  ok: number;
  expected: number;
  hardOk: number;
  hardExpected: number;
  msTotal: number;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}
function pct(n: number, d: number): string {
  return d === 0 ? '  –  ' : `${((100 * n) / d).toFixed(0).padStart(3)}%`;
}

async function main() {
  const images = existsSync(SAMPLES)
    ? readdirSync(SAMPLES).filter((f) => ['.jpg', '.jpeg', '.png', '.webp'].includes(extname(f).toLowerCase()))
    : [];
  if (!images.length) {
    console.error(
      `No photos found in ${SAMPLES}\n` +
        `Drop the sample photos there (.jpg/.jpeg/.png/.webp). Add a sibling <name>.expected.json\n` +
        `(copy expected.template.json) to get a scored accuracy table + the Phase-A gate; without it\n` +
        `you still get an OCR preview of the extracted fields.`,
    );
    process.exit(2);
  }
  const scored = images.filter((f) => existsSync(join(SAMPLES, `${basename(f, extname(f))}.expected.json`)));
  const unscored = images.filter((f) => !scored.includes(f));

  const psms = psmList();
  console.log(
    `Photos: ${images.length} (${scored.length} scored, ${unscored.length} preview)   ` +
      `PSMs: ${psms.map(String).join(',')}   (variants via SPIKE_VARIANTS env)\n`,
  );

  const configs = new Map<string, ConfigAgg>();

  for (const img of scored) {
    const base = basename(img, extname(img));
    const expected = JSON.parse(readFileSync(join(SAMPLES, `${base}.expected.json`), 'utf8')) as Partial<ScanFields>;
    const variants = await buildVariants(readFileSync(join(SAMPLES, img)));
    process.stdout.write(`· ${img} `);

    for (const v of variants) {
      for (const psm of psms) {
        const { words, ms } = await recognize(v.buffer, LANG_PATH, psm);
        if (process.env.SPIKE_DEBUG_WORDS) {
          console.log(`\n--- words: ${img} ${v.name}·psm${psm} (${words.length}) ---`);
          console.log(words.map((w) => `${w.text}@${Math.round(w.confidence)}`).join(' | '));
        }
        const { fields } = parseOcrWords(words, v.width, v.height);

        const cells: Record<string, Cell> = {};
        let ok = 0, exp = 0, hOk = 0, hExp = 0;
        for (const f of FIELDS) {
          const c = compareField(f, (expected[f] ?? null) as string | null, fields[f]);
          cells[f] = c;
          if (c !== 'na') exp++;
          if (c === 'ok') ok++;
          if (HARD.includes(f)) {
            if (c !== 'na') hExp++;
            if (c === 'ok') hOk++;
          }
        }
        const key = `${v.name}·psm${psm}`;
        let agg = configs.get(key);
        if (!agg) {
          agg = { key, variant: v.name, psm, runs: [], ok: 0, expected: 0, hardOk: 0, hardExpected: 0, msTotal: 0 };
          configs.set(key, agg);
        }
        agg.runs.push({ sample: img, fields, cells, ms, ok, expected: exp, hardOk: hOk, hardExpected: hExp });
        agg.ok += ok; agg.expected += exp; agg.hardOk += hOk; agg.hardExpected += hExp; agg.msTotal += ms;
        process.stdout.write('.');
      }
    }
    process.stdout.write('\n');
  }
  // ── leaderboard + winner (scored samples only) ─────────────────────────────
  let win: ConfigAgg | undefined;
  if (scored.length) {
    const ranked = [...configs.values()].sort((a, b) => {
      const sa = a.hardOk / Math.max(1, a.hardExpected) * 2 + a.ok / Math.max(1, a.expected);
      const sb = b.hardOk / Math.max(1, b.hardExpected) * 2 + b.ok / Math.max(1, b.expected);
      return sb - sa;
    });

    console.log('\n══ Leaderboard (variant · psm) ' + '═'.repeat(28));
    console.log(`${pad('config', 20)} ${pad('hard', 6)} ${pad('overall', 8)} ${pad('avg ms', 8)}`);
    for (const c of ranked) {
      console.log(
        `${pad(c.key, 20)} ${pad(pct(c.hardOk, c.hardExpected), 6)} ${pad(pct(c.ok, c.expected), 8)} ` +
          `${pad(String(Math.round(c.msTotal / c.runs.length)), 8)}`,
      );
    }

    win = ranked[0];
    console.log(`\n══ Winner: ${win.key} ` + '═'.repeat(Math.max(4, 40 - win.key.length)));

    // per-field accuracy for the winner
    console.log('\nPer-field accuracy (winner):');
    for (const f of FIELDS) {
      let ok = 0, exp = 0;
      for (const r of win.runs) {
        const c = r.cells[f];
        if (c !== 'na') exp++;
        if (c === 'ok') ok++;
      }
      const bar = HARD.includes(f) ? ' [hard]' : '';
      console.log(`  ${pad(f, 18)} ${pad(pct(ok, exp), 6)} (${ok}/${exp})${bar}`);
    }

    // per-sample detail
    const glyph: Record<Cell, string> = { ok: '✓', bad: '✗', miss: '·', na: ' ' };
    for (const r of win.runs) {
      console.log(`\n[${r.sample}]  ${r.ok}/${r.expected} fields  ${Math.round(r.ms)}ms`);
      for (const f of FIELDS) {
        if (r.cells[f] === 'na') continue;
        const got = r.fields[f] ?? 'null';
        console.log(`  ${glyph[r.cells[f]]} ${pad(f, 18)} ${got}`);
      }
    }
  }

  // ── preview: photos WITHOUT ground truth — OCR + extracted fields, no score ──
  if (unscored.length) {
    const wantVariant = process.env.SPIKE_VARIANTS?.split(',')[0]?.trim() || win?.variant || 'app2560';
    const previewPsm = win?.psm ?? psms[0];
    console.log(`\n══ Preview — no ground truth (${wantVariant}·psm${previewPsm}) ` + '═'.repeat(14));
    console.log('  add a sibling <name>.expected.json (copy expected.template.json) to score + run the gate.');
    for (const img of unscored) {
      const variants = await buildVariants(readFileSync(join(SAMPLES, img)));
      const v = variants.find((x) => x.name === wantVariant) ?? variants[0];
      const { words, ms } = await recognize(v.buffer, LANG_PATH, previewPsm);
      if (process.env.SPIKE_DEBUG_WORDS) {
        console.log(`\n--- words: ${img} ${v.name}·psm${previewPsm} (${words.length}) ---`);
        console.log(words.map((w) => `${w.text}@${Math.round(w.confidence)}`).join(' | '));
      }
      const { fields, confidence } = parseOcrWords(words, v.width, v.height);
      const got = FIELDS.filter((f) => fields[f]).length;
      console.log(`\n[${img}]  ${got}/13 fields extracted  ${Math.round(ms)}ms`);
      for (const f of FIELDS) {
        if (!fields[f]) continue;
        const c = confidence[f];
        console.log(`  ${pad(f, 18)} ${pad(String(fields[f]), 26)} ${c != null ? `conf ${c}` : ''}`);
      }
    }
  }

  await terminateAll();

  // ── gate (scored samples only) ─────────────────────────────────────────────
  if (!win) {
    console.log('\nPreview only — no scored samples, so the Phase-A gate was not evaluated.\n');
    process.exit(0);
  }
  const hardAcc = win.hardOk / Math.max(1, win.hardExpected);
  const overallAcc = win.ok / Math.max(1, win.expected);
  const avgMs = win.msTotal / win.runs.length;
  const passHard = hardAcc >= GATE_HARD;
  const passOverall = overallAcc >= GATE_OVERALL;
  const passMs = avgMs < GATE_MS;

  console.log('\n══ Phase-A gate ' + '═'.repeat(44));
  console.log(`  hard fields ≥ ${(GATE_HARD * 100).toFixed(0)}% : ${(hardAcc * 100).toFixed(0)}%  ${passHard ? 'PASS' : 'FAIL'}`);
  console.log(`  overall ≥ ${(GATE_OVERALL * 100).toFixed(0)}%     : ${(overallAcc * 100).toFixed(0)}%  ${passOverall ? 'PASS' : 'FAIL'}`);
  console.log(`  recognition < ${(GATE_MS / 1000).toFixed(0)}s   : ${(avgMs / 1000).toFixed(1)}s  ${passMs ? 'PASS' : 'FAIL'}`);
  const gate = passHard && passOverall && passMs;
  console.log(`\n  GATE: ${gate ? 'PASS → proceed to Phase B' : 'FAIL → tune parser/preprocessing before Phase B'}\n`);
  process.exit(gate ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(3);
});
