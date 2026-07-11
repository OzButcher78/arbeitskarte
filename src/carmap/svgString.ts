// ============================================================================
// carMapSvgString — the FlatCarMap2 blueprint as a self-contained SVG string
// for embedding in the print HTML. Parses the raw SVG, bakes the `.selected`
// class onto the damaged panels and appends the freehand strokes into
// #DrawLayer, then serialises. The SVG's own embedded <style> carries all the
// fills, so no colour logic is needed here. Renderer-only (print HTML is built
// in App.tsx), so DOMParser/XMLSerializer are always available.
// ============================================================================

import rawSvg from './FlatCarMap2.svg?raw';
import type { DamageStroke } from '../types/jobcard';
import { strokeToPathD } from './strokes';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function carMapSvgString(selected: Set<string>, strokes: DamageStroke[]): string {
  const doc = new DOMParser().parseFromString(rawSvg, 'image/svg+xml');
  const root = doc.documentElement;
  // Defensive: a malformed parse → embed the raw SVG unmodified (it still draws
  // the blueprint, just without baked-in selection/strokes).
  if (root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return rawSvg;

  selected.forEach((key) => {
    doc.querySelectorAll(`[data-panel="${key}"]`).forEach((el) => el.classList.add('selected'));
  });

  if (strokes.length) {
    const drawLayer = doc.querySelector('#DrawLayer');
    if (drawLayer) {
      for (const stroke of strokes) {
        const path = doc.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', strokeToPathD(stroke));
        drawLayer.appendChild(path);
      }
    }
  }

  return new XMLSerializer().serializeToString(root);
}
