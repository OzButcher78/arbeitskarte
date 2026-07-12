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

import { mkdirSync, copyFileSync, existsSync, statSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
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

// German traineddata — DECOMPRESS the vendored .gz to a plain .traineddata.
// Android's AAPT auto-gunzips every *.gz asset and drops the extension when
// packing the APK, so a shipped `deu.traineddata.gz` 404s at runtime (the file
// on device is `deu.traineddata`). Shipping it already-decompressed — and
// loading it with `gzip:false` in engine.ts — gives ONE filename that resolves
// identically under Vite dev, packaged Electron and the Android WebView.
{
  const src = join(root, 'tools/ocr-spike/tessdata/deu.traineddata.gz');
  if (!existsSync(src)) {
    console.error('MISSING: tools/ocr-spike/tessdata/deu.traineddata.gz');
    process.exit(1);
  }
  writeFileSync(join(lang, 'deu.traineddata'), gunzipSync(readFileSync(src)));
  // Drop any stale gzipped copy from an earlier vendoring.
  rmSync(join(lang, 'deu.traineddata.gz'), { force: true });
  const kb = Math.round(statSync(join(lang, 'deu.traineddata')).size / 1024);
  total += kb;
  console.log(`  ${'lang/deu.traineddata'.padEnd(34)} ${kb} KB (decompressed)`);
}

console.log(`\npublic/tesseract/ vendored — ${(total / 1024).toFixed(1)} MB total`);
