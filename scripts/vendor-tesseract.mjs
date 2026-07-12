// ============================================================================
// Vendor the browser Tesseract.js runtime assets into public/tesseract/ so the
// offline OCR provider loads everything from the app itself — no CDN, works
// under Vite dev (/), packaged Electron (file:// → ./) and the Android WebView.
//
// Run after `npm install` or when bumping tesseract.js; the OUTPUT is committed.
//   node scripts/vendor-tesseract.mjs
//
// We ship ONLY the SIMD LSTM core (the engine runs OEM.LSTM_ONLY, and every
// target — Electron/Chromium and the Android WebView — supports WASM SIMD). The
// `.wasm.js` is a single-file emscripten build with the wasm embedded as base64,
// so the standalone `.wasm` is redundant and the non-SIMD fallback is unneeded;
// dropping both trims the vendored payload from ~13.9 MB to ~4.8 MB.
// ============================================================================

import { mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'tesseract');
const lang = join(out, 'lang');
mkdirSync(lang, { recursive: true });

const copies = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  // SIMD LSTM core only — single-file build with the wasm embedded as base64.
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  // Reuse the traineddata already vendored for the spike (tessdata_fast, German).
  ['tools/ocr-spike/tessdata/deu.traineddata.gz', 'lang/deu.traineddata.gz'],
];

let total = 0;
for (const [from, to] of copies) {
  const src = join(root, from);
  if (!existsSync(src)) {
    console.error(`MISSING: ${from} — run "npm install" first.`);
    process.exit(1);
  }
  const dst = join(out, to);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  const kb = Math.round(statSync(dst).size / 1024);
  total += kb;
  console.log(`  ${to.padEnd(34)} ${kb} KB`);
}
console.log(`\npublic/tesseract/ vendored — ${(total / 1024).toFixed(1)} MB total`);
