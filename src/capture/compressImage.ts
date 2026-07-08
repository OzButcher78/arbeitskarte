// ============================================================================
// IMAGE COMPRESSION UTILITY — Browser Canvas API.
// EXIF (incl. GPS) is stripped automatically by the canvas encoder.
// Returns encoded bytes + base64 data URL + a SHA-256 content hash (dedup /
// stable filename).
// ============================================================================

import { toBufferSource } from '../utils/bufferSource';

export type PhotoQualityPreset = 'small' | 'standard' | 'high' | 'preview';

export interface CompressedPhoto {
  /** Base64 JPEG data URL. */
  dataUrl: string;
  /** Raw JPEG bytes. Same payload as the dataUrl. */
  bytes: Uint8Array;
  /** SHA-256 fingerprint of the JPEG bytes, truncated to 16 hex chars. */
  contentHash: string;
  /** Byte length of the compressed JPEG. */
  sizeBytes: number;
}

const PRESETS: Record<PhotoQualityPreset, { maxDimension: number; quality: number }> = {
  small: { maxDimension: 1280, quality: 0.65 },
  standard: { maxDimension: 1920, quality: 0.75 },
  high: { maxDimension: 2560, quality: 0.85 },
  preview: { maxDimension: 1000, quality: 0.6 },
};

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, '0');
  }
  return s;
}

async function computeBytesHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toBufferSource(bytes));
  return bytesToHex(new Uint8Array(digest)).slice(0, 16);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error('FileReader failed'));
    r.readAsDataURL(blob);
  });
}

/**
 * Rotate a JPEG/PNG dataUrl by a quarter-turn multiple (0–3 × 90° clockwise)
 * and return a fresh CompressedPhoto. Baking rotation into the bytes (instead of
 * a flag) keeps every downstream renderer seeing a natural-orientation image.
 *
 * @param quarters Number of 90° CLOCKWISE turns (any integer; reduced mod 4).
 */
export async function rotateImageDataUrlQuarters(dataUrl: string, quarters: number): Promise<CompressedPhoto> {
  const q = ((Math.trunc(quarters) % 4) + 4) % 4;
  return new Promise<CompressedPhoto>((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      const swap = q === 1 || q === 3;
      const canvas = document.createElement('canvas');
      canvas.width = swap ? img.height : img.width;
      canvas.height = swap ? img.width : img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas-Kontext nicht verfügbar'));
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (q === 1) {
        ctx.translate(canvas.width, 0);
        ctx.rotate(Math.PI / 2);
      } else if (q === 2) {
        ctx.translate(canvas.width, canvas.height);
        ctx.rotate(Math.PI);
      } else if (q === 3) {
        ctx.translate(0, canvas.height);
        ctx.rotate(-Math.PI / 2);
      }
      ctx.drawImage(img, 0, 0);

      canvas.toBlob(
        async (b) => {
          if (!b) { reject(new Error('Canvas.toBlob lieferte kein Ergebnis')); return; }
          try {
            const bytes = new Uint8Array(await b.arrayBuffer());
            const [contentHash, newDataUrl] = await Promise.all([computeBytesHash(bytes), blobToDataUrl(b)]);
            resolve({ dataUrl: newDataUrl, bytes, contentHash, sizeBytes: bytes.byteLength });
          } catch (e) { reject(e); }
        },
        'image/jpeg',
        0.85,
      );
    };
    img.onerror = () => reject(new Error('Bild konnte nicht für Rotation geladen werden'));
    img.src = dataUrl;
  });
}

/** Rotate a dataUrl exactly 90° clockwise. */
export async function rotateImageDataUrlClockwise90(dataUrl: string): Promise<CompressedPhoto> {
  return rotateImageDataUrlQuarters(dataUrl, 1);
}

/**
 * Compress an image file: resize to maxDimension on the longer edge (never
 * upscales), encode JPEG at the preset quality, strip EXIF/GPS.
 */
export async function compressImage(
  file: File | Blob,
  preset: PhotoQualityPreset = 'standard',
): Promise<CompressedPhoto> {
  const { maxDimension, quality } = PRESETS[preset];

  const blob = await new Promise<Blob>((resolve, reject) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        if (width >= height) {
          height = Math.round((height / width) * maxDimension);
          width = maxDimension;
        } else {
          width = Math.round((width / height) * maxDimension);
          height = maxDimension;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas-Kontext nicht verfügbar'));
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (b) => {
          if (!b) { reject(new Error('Canvas.toBlob lieferte kein Ergebnis')); return; }
          resolve(b);
        },
        'image/jpeg',
        quality,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Bild konnte nicht geladen werden'));
    };
    img.src = url;
  });

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const [contentHash, dataUrl] = await Promise.all([computeBytesHash(bytes), blobToDataUrl(blob)]);
  return { dataUrl, bytes, contentHash, sizeBytes: bytes.byteLength };
}
