// ============================================================================
// Stroke geometry — shared by the live CarMap renderer and the print bake-in.
// Coordinates are in FlatCarMap2 viewBox space ("185 460 2095 1575").
// ============================================================================

import type { DamageStroke } from '../types/jobcard';

/** Minimum viewBox distance between consecutive captured points (skip closer). */
export const MIN_POINT_DIST = 3;

/** SVG path `d` for a stroke. A single-point stroke emits `M p L p` — a
 *  zero-length segment which, with the SVG's round caps, renders as a dot. */
export function strokeToPathD(stroke: DamageStroke): string {
  if (stroke.length === 0) return '';
  const [first, ...rest] = stroke;
  const move = `M ${first[0]},${first[1]}`;
  if (rest.length === 0) return `${move} L ${first[0]},${first[1]}`;
  return `${move} ${rest.map((p) => `L ${p[0]},${p[1]}`).join(' ')}`;
}
