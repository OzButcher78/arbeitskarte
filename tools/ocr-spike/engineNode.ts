// ============================================================================
// Spike engine — Tesseract.js v6 in Node, producing the SAME OcrWord[] shape the
// app parser consumes. Kept dead-simple: recognise a preprocessed image buffer
// under a given page-segmentation mode and flatten the block tree to words.
//
// v6 note: word bounding boxes only come back when you request `{ blocks: true }`
// from recognize(); the result then carries a blocks→paragraphs→lines→words tree
// (older builds exposed data.words directly — we handle both).
// ============================================================================

import { performance } from 'node:perf_hooks';
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import type { OcrWord } from '../../src/scan/localOcr/parseOcrWords.ts';

export { PSM };

const workers = new Map<PSM, Promise<Worker>>();

async function getWorker(langPath: string, psm: PSM): Promise<Worker> {
  let p = workers.get(psm);
  if (!p) {
    p = (async () => {
      const worker = await createWorker('deu', OEM.LSTM_ONLY, {
        langPath,
        cacheMethod: 'none',
        gzip: true,
      });
      await worker.setParameters({
        tessedit_pageseg_mode: psm,
        preserve_interword_spaces: '1',
      });
      return worker;
    })();
    workers.set(psm, p);
  }
  return p;
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

export interface RecognizeResult {
  words: OcrWord[];
  ms: number;
}

export async function recognize(buffer: Buffer, langPath: string, psm: PSM): Promise<RecognizeResult> {
  const worker = await getWorker(langPath, psm);
  const t0 = performance.now();
  const { data } = await worker.recognize(buffer, {}, { blocks: true, text: false });
  const ms = performance.now() - t0;
  return { words: flattenWords(data), ms };
}

export async function terminateAll(): Promise<void> {
  for (const p of workers.values()) {
    try {
      (await p).terminate();
    } catch {
      /* ignore */
    }
  }
  workers.clear();
}
