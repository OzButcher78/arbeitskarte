// ============================================================================
// Preprocessing matrix (sharp). One input photo → several candidate images, so
// the spike can find which preprocessing gives Tesseract the best read:
//   full     — original pixels, EXIF-orientation baked in (no resize/recompress)
//   app2560  — the REAL app pipeline: 2560px longest edge, JPEG q0.85
//              (= compressImage preset 'high') → what production would feed OCR
//   gray     — app2560 + grayscale + contrast normalize     (current winner)
//   up2x     — app2560 upscaled 2× (helps small typewriter glyphs)
//   sharpen  — gray + unsharp mask (crisper glyph edges)
//   binar    — sharpen + global threshold → clean bilevel (Tesseract loves it)
//   clahe    — grayscale + CLAHE (ADAPTIVE local contrast — beats a global
//              normalize on phone photos with glare/shadow) + sharpen
//   clahebin — clahe + threshold
//   hi3200   — higher-DPI base (3200px longest edge) + gray + normalize + sharpen
//              (the "Estimating resolution as ~230" logs show 2560px reads low-DPI)
//   hiclahe  — hi3200 + CLAHE + sharpen
// The winning variant is baked into the app engine in Phase B.
// ============================================================================

import sharp from 'sharp';

export interface Variant {
  name: string;
  buffer: Buffer;
  width: number;
  height: number;
}

const APP_MAX = 2560; // compressImage 'high' preset — longest edge
const APP_Q = 85; // compressImage 'high' preset — JPEG quality 0.85
const HI_MAX = 3200; // higher-DPI base for the small typewriter print

/** Optional allow-list from env: SPIKE_VARIANTS="gray,binar,clahe". */
function wanted(): Set<string> | null {
  const raw = process.env.SPIKE_VARIANTS?.trim();
  if (!raw) return null;
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

async function toVariant(name: string, pipeline: sharp.Sharp): Promise<Variant> {
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return { name, buffer: data, width: info.width, height: info.height };
}

export async function buildVariants(input: Buffer): Promise<Variant[]> {
  const filter = wanted();
  const keep = (name: string) => !filter || filter.has(name);
  const out: Variant[] = [];

  // Two bases the derived variants build on: the real app pipeline (2560px) and
  // a higher-DPI base (3200px) for the small print.
  const app = await sharp(input)
    .rotate()
    .resize(APP_MAX, APP_MAX, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: APP_Q })
    .toBuffer({ resolveWithObject: true });
  const hi = await sharp(input)
    .rotate()
    .resize(HI_MAX, HI_MAX, { fit: 'inside', withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true });

  if (keep('full')) out.push(await toVariant('full', sharp(input).rotate()));
  if (keep('app2560')) out.push({ name: 'app2560', buffer: app.data, width: app.info.width, height: app.info.height });
  if (keep('gray')) out.push(await toVariant('gray', sharp(app.data).grayscale().normalize().jpeg({ quality: 90 })));
  if (keep('up2x')) {
    out.push(await toVariant('up2x', sharp(app.data).resize({ width: Math.round(app.info.width * 2) }).jpeg({ quality: 90 })));
  }
  if (keep('sharpen')) {
    out.push(await toVariant('sharpen', sharp(app.data).grayscale().normalize().sharpen({ sigma: 1 }).jpeg({ quality: 92 })));
  }
  if (keep('binar')) {
    out.push(
      await toVariant('binar', sharp(app.data).grayscale().normalize().sharpen({ sigma: 1 }).threshold(128).png()),
    );
  }
  if (keep('clahe')) {
    out.push(
      await toVariant('clahe', sharp(app.data).grayscale().clahe({ width: 64, height: 64, maxSlope: 3 }).sharpen({ sigma: 1 }).jpeg({ quality: 92 })),
    );
  }
  if (keep('clahebin')) {
    out.push(
      await toVariant('clahebin', sharp(app.data).grayscale().clahe({ width: 64, height: 64, maxSlope: 3 }).sharpen({ sigma: 1 }).threshold(128).png()),
    );
  }
  if (keep('hi3200')) {
    out.push(await toVariant('hi3200', sharp(hi.data).grayscale().normalize().sharpen({ sigma: 1 }).jpeg({ quality: 92 })));
  }
  if (keep('hiclahe')) {
    out.push(
      await toVariant('hiclahe', sharp(hi.data).grayscale().clahe({ width: 80, height: 80, maxSlope: 3 }).sharpen({ sigma: 1 }).jpeg({ quality: 92 })),
    );
  }
  return out;
}
