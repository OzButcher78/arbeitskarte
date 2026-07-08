// ============================================================================
// scanRedaction — pure coordinate transform for the document scanner.
// ----------------------------------------------------------------------------
// Isolates the crop + downscale + (optional) owner-block redaction math so it
// can be unit-tested without a DOM. DocumentScanModal.buildCroppedBase64 is a
// thin caller that draws the source rect and bakes any fills into the exported
// bytes. In Arbeitskarte redaction is OFF by default (Grab wants the Halter
// data); the geometry stays available as an opt-in toggle.
//
// Coordinate spaces: display (CSS px of the <img>), natural (intrinsic px),
// source (the drawn sub-rect / crop), output (exported canvas, downscaled).
// ============================================================================

import { isSwiss } from '../utils/countries';

/** Long-edge cap (px) for the exported scan canvas — downscale for faster calls
 *  and lower token cost while keeping small text legible. */
export const MAX_OUTPUT_EDGE = 2048;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ScanCanvasInput {
  crop: Rect;
  redactRects: Rect[];
  useFullImage: boolean;
  natW: number;
  natH: number;
  displayW: number;
  displayH: number;
  maxEdge: number;
}

export interface ScanCanvasPlan {
  canvasW: number;
  canvasH: number;
  source: { sx: number; sy: number; sw: number; sh: number };
  fills: Rect[];
}

/**
 * Compute the export canvas dimensions, the source rect to draw, and the
 * redaction fills — all from pure numbers, no DOM.
 */
export function computeScanCanvas(input: ScanCanvasInput): ScanCanvasPlan {
  const { crop, redactRects, useFullImage, natW, natH, displayW, displayH, maxEdge } = input;

  if (!(natW > 0) || !(natH > 0)) {
    return {
      canvasW: 1,
      canvasH: 1,
      source: { sx: 0, sy: 0, sw: Math.max(1, natW), sh: Math.max(1, natH) },
      fills: [],
    };
  }

  const hasDisplay = displayW > 0 && displayH > 0;
  const scaleX = hasDisplay ? natW / displayW : 1;
  const scaleY = hasDisplay ? natH / displayH : 1;

  let sx = 0;
  let sy = 0;
  let sw = natW;
  let sh = natH;
  const useCrop = !useFullImage && hasDisplay && crop && crop.w > 8 && crop.h > 8;
  if (useCrop) {
    sx = crop.x * scaleX;
    sy = crop.y * scaleY;
    sw = crop.w * scaleX;
    sh = crop.h * scaleY;
  }

  let outW = sw;
  let outH = sh;
  const longEdge = Math.max(outW, outH);
  if (maxEdge > 0 && Number.isFinite(maxEdge) && longEdge > maxEdge) {
    const k = maxEdge / longEdge;
    outW *= k;
    outH *= k;
  }
  const canvasW = Math.max(1, Math.round(outW));
  const canvasH = Math.max(1, Math.round(outH));

  const fx = canvasW / sw;
  const fy = canvasH / sh;

  const fills: Rect[] = [];
  for (const r of redactRects || []) {
    if (!r || !(r.w > 0) || !(r.h > 0)) continue;
    let ox = (r.x * scaleX - sx) * fx;
    let oy = (r.y * scaleY - sy) * fy;
    let ow = r.w * scaleX * fx;
    let oh = r.h * scaleY * fy;
    if (ox < 0) { ow += ox; ox = 0; }
    if (oy < 0) { oh += oy; oy = 0; }
    if (ox + ow > canvasW) ow = canvasW - ox;
    if (oy + oh > canvasH) oh = canvasH - oy;
    if (ow <= 0 || oh <= 0) continue;
    fills.push({ x: ox, y: oy, w: ow, h: oh });
  }

  return { canvasW, canvasH, source: { sx, sy, sw, sh }, fills };
}

/**
 * Default (opt-in) redaction box seeded over the owner/holder block. Coordinates
 * are fractions of the passed display box.
 *   • CH — Halter block sits top-left of the Fahrzeugausweis.
 *   • DE / AT / EU — holder block sits lower-left of Teil I.
 */
export function defaultRedactionBox(country: string | undefined, w: number, h: number): Rect {
  const mx = w * 0.04;
  const my = h * 0.04;
  return isSwiss(country)
    ? { x: mx, y: my, w: w * 0.42, h: h * 0.325 }
    : { x: mx, y: h * 0.54, w: w * 0.30, h: h * 0.36 };
}

/** The rendered content rectangle of (natW×natH) drawn into (boxW×boxH) under
 *  CSS `object-contain` — scaled to fit, centred, with letterbox offsets. */
export interface ContainFit {
  w: number;
  h: number;
  offsetX: number;
  offsetY: number;
}
export function fitContain(natW: number, natH: number, boxW: number, boxH: number): ContainFit {
  if (!(natW > 0) || !(natH > 0) || !(boxW > 0) || !(boxH > 0)) {
    return { w: Math.max(0, boxW), h: Math.max(0, boxH), offsetX: 0, offsetY: 0 };
  }
  const scale = Math.min(boxW / natW, boxH / natH);
  const w = natW * scale;
  const h = natH * scale;
  return { w, h, offsetX: (boxW - w) / 2, offsetY: (boxH - h) / 2 };
}

/**
 * Rotate a DISPLAY-space Rect by one quarter turn and return it as NORMALIZED
 * fractions ([0,1]) of the POST-rotation display box, so the caller can re-place
 * it independent of the new render scale. `dir` is the image's turn direction.
 */
export function rotateRectNormalized(r: Rect, dispW: number, dispH: number, dir: 'cw' | 'ccw'): Rect {
  if (!(dispW > 0) || !(dispH > 0)) return { x: 0, y: 0, w: 0, h: 0 };
  const fx = r.x / dispW;
  const fy = r.y / dispH;
  const fw = r.w / dispW;
  const fh = r.h / dispH;
  return dir === 'cw'
    ? { x: 1 - (fy + fh), y: fx, w: fh, h: fw }
    : { x: fy, y: 1 - (fx + fw), w: fh, h: fw };
}
