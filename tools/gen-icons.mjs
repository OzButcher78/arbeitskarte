// Generate Windows + Android launcher icons from arbeitskarte.svg / .ico.
// Run from repo root:  node scratchpad/gen-icons.mjs
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SVG = path.join(ROOT, 'arbeitskarte.svg');
const ICO = path.join(ROOT, 'arbeitskarte.ico');
const svgRaw = readFileSync(SVG, 'utf8');

// ── 1. Windows: build/icon.ico (electron-builder buildResources) ────────────
const buildDir = path.join(ROOT, 'build');
if (!existsSync(buildDir)) mkdirSync(buildDir, { recursive: true });
copyFileSync(ICO, path.join(buildDir, 'icon.ico'));
// A 512px PNG is also handy for the Linux/runtime window icon.
await sharp(Buffer.from(svgRaw), { density: 512 })
  .resize(512, 512)
  .png()
  .toFile(path.join(buildDir, 'icon.png'));
console.log('✓ build/icon.ico + build/icon.png');

// ── 2. Android launcher icons ───────────────────────────────────────────────
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');

// Foreground = the card artwork WITHOUT the blue background tile, padded so it
// lands inside the adaptive-icon safe zone (masks crop the outer ring).
const fgSvg = svgRaw
  .replace(/<rect x="0" y="0" width="256" height="256"[^>]*fill="url\(#bg\)"\/>/, '')
  .replace('viewBox="0 0 256 256"', 'viewBox="-30 -30 316 316"');

// Legacy (pre-API-26) square launcher densities.
const LAUNCHER = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
// Adaptive foreground densities (108dp canvas).
const FOREGROUND = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

async function renderSvg(svg, size) {
  return sharp(Buffer.from(svg), { density: Math.max(256, size * 4) })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

function circleMask(size) {
  const r = size / 2;
  return Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${r}" cy="${r}" r="${r}" fill="#fff"/></svg>`,
  );
}

for (const [dpi, size] of Object.entries(LAUNCHER)) {
  const dir = path.join(RES, `mipmap-${dpi}`);
  // Square legacy icon = full design (incl. blue tile, already rounded).
  const square = await renderSvg(svgRaw, size);
  writeFileSync(path.join(dir, 'ic_launcher.png'), square);
  // Round legacy icon = full design masked to a circle.
  const round = await sharp(square)
    .composite([{ input: circleMask(size), blend: 'dest-in' }])
    .png()
    .toBuffer();
  writeFileSync(path.join(dir, 'ic_launcher_round.png'), round);
  // Adaptive foreground (card art only, transparent bg).
  const fg = await renderSvg(fgSvg, FOREGROUND[dpi]);
  writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), fg);
  console.log(`✓ mipmap-${dpi} (launcher ${size}, foreground ${FOREGROUND[dpi]})`);
}

console.log('Done.');
