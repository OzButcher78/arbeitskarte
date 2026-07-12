// ============================================================================
// Local (offline) OCR engine — RENDERER only. Runs Tesseract.js entirely on the
// device: no network, no API key, no PII leaving the machine. Dynamically
// imported so the ~14 MB wasm/worker/lang payload loads ONLY when the user picks
// the offline scanner (never for the cloud path or app start).
//
// All runtime assets are served from the app itself (public/tesseract/, vendored
// by scripts/vendor-tesseract.mjs): `new URL('tesseract/…', document.baseURI)`
// resolves under Vite dev ("/"), packaged Electron (file:// → "./") and the
// Android WebView alike. The winning spike config is baked in: German LSTM,
// PSM 11 (sparse text) — see tools/ocr-spike.
//
// Output is the SAME OcrWord[] the shared parser consumes, so scanning reuses
// parseOcrWords() unchanged.
// ============================================================================

import type { OcrWord } from './parseOcrWords';

// tesseract.js Worker — typed loosely to avoid bundling its types into the app.
let workerPromise: Promise<any> | null = null;

/** Base URL of the vendored assets, resolved against the current document. */
function assetBase(): string {
  return new URL('tesseract/', document.baseURI).href;
}

async function getWorker(): Promise<any> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, OEM, PSM } = await import('tesseract.js');
      const base = assetBase();
      const worker = await createWorker('deu', OEM.LSTM_ONLY, {
        workerPath: `${base}worker.min.js`,
        corePath: base, // directory — tesseract picks the (simd-)lstm core by capability
        langPath: base.replace(/\/$/, '') + '/lang',
        gzip: true,
        cacheMethod: 'none',
      });
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT, // PSM 11 — spike winner
        preserve_interword_spaces: '1',
      });
      return worker;
    })().catch((e) => {
      workerPromise = null; // allow a later retry after a transient failure
      throw e;
    });
  }
  return workerPromise;
}

/** Kick off worker + asset load ahead of the first scan (called when the modal
 *  opens in offline mode). Swallows errors — they resurface on the real scan. */
export async function warmUpLocalOcr(): Promise<void> {
  try {
    await getWorker();
  } catch {
    /* surfaced on the actual scan call */
  }
}

function pushWord(out: OcrWord[], w: any): void {
  if (!w || typeof w.text !== 'string' || !w.text.trim()) return;
  const b = w.bbox || {};
  out.push({
    text: w.text,
    confidence: typeof w.confidence === 'number' ? w.confidence : 0,
    bbox: { x0: b.x0 ?? 0, y0: b.y0 ?? 0, x1: b.x1 ?? 0, y1: b.y1 ?? 0 },
  });
}

function flattenWords(data: any): OcrWord[] {
  const out: OcrWord[] = [];
  if (Array.isArray(data?.words) && data.words.length) {
    for (const w of data.words) pushWord(out, w);
    return out;
  }
  for (const block of data?.blocks || []) {
    for (const para of block?.paragraphs || []) {
      for (const line of para?.lines || []) {
        for (const w of line?.words || []) pushWord(out, w);
      }
    }
  }
  return out;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Bild konnte nicht geladen werden'));
    img.src = src;
  });
}

/**
 * Reproduce the winning spike preprocessing IN THE BROWSER: grayscale + a
 * percentile-clipped contrast stretch (the `gray` variant = sharp
 * grayscale().normalize()). This is HALF of the winning config — feeding Tesseract
 * the plain colour photo (app2560) scored 44 % hard vs 63 % for gray at PSM 11.
 * Falls back to the untouched image if the canvas is unavailable.
 */
async function preprocessForOcr(dataUrl: string): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || !w || !h) return { dataUrl, width: w, height: h };

  ctx.drawImage(img, 0, 0);
  const image = ctx.getImageData(0, 0, w, h);
  const px = image.data;
  const n = w * h;

  // grayscale (luma) + histogram
  const gray = new Uint8ClampedArray(n);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const y = (px[p] * 0.299 + px[p + 1] * 0.587 + px[p + 2] * 0.114) | 0;
    gray[i] = y;
    hist[y]++;
  }

  // contrast stretch to the 0.5 %–99.5 % luminance range (outlier-robust)
  const clip = Math.max(1, Math.floor(n * 0.005));
  let lo = 0;
  let hi = 255;
  for (let v = 0, acc = 0; v < 256; v++) { acc += hist[v]; if (acc > clip) { lo = v; break; } }
  for (let v = 255, acc = 0; v >= 0; v--) { acc += hist[v]; if (acc > clip) { hi = v; break; } }
  const range = hi > lo ? hi - lo : 1;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    let y = ((gray[i] - lo) * 255) / range;
    y = y < 0 ? 0 : y > 255 ? 255 : y;
    px[p] = px[p + 1] = px[p + 2] = y | 0;
  }
  ctx.putImageData(image, 0, 0);
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.9), width: w, height: h };
}

export interface LocalOcrResult {
  words: OcrWord[];
  width: number;
  height: number;
}

/** Recognise a full-frame image entirely on-device, applying the winning spike
 *  preprocessing first. `imageBase64` may be a bare base64 string or a data: URL. */
export async function runLocalOcr(imageBase64: string, mimeType: string): Promise<LocalOcrResult> {
  const worker = await getWorker();
  const mime = mimeType || 'image/jpeg';
  const srcUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:${mime};base64,${imageBase64}`;
  const prepped = await preprocessForOcr(srcUrl);
  const { data } = await worker.recognize(prepped.dataUrl, {}, { blocks: true, text: false });
  return { words: flattenWords(data), width: prepped.width, height: prepped.height };
}
