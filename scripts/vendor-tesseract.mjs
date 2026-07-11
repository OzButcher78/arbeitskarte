// ============================================================================
// Vendor the browser Tesseract.js runtime assets into public/tesseract/ so the
// offline OCR provider loads everything from the app itself — no CDN, works
// under Vite dev (/), packaged Electron (file:// → ./) and the Android WebView.
//
// Run after `npm install` or when bumping tesseract.js; the OUTPUT is committed.
//   node scripts/vendor-tesseract.mjs
//
// We ship only the LSTM cores (the engine runs OEM.LSTM_ONLY): the SIMD build
// (used by every modern engine) plus the plain build as a fallback.
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
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm', 'tesseract-core-simd-lstm.wasm'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm', 'tesseract-core-lstm.wasm'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
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
