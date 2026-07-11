// ============================================================================
// CarMap — the commissioned FlatCarMap2 blueprint, inlined and made interactive.
// ----------------------------------------------------------------------------
// The SVG (imported raw) owns ALL geometry and ALL visual state: hover/selected
// fills per category live in its embedded <style>; this component only toggles
// a `.selected` class on `[data-panel]` elements and draws freehand strokes
// into `#DrawLayer`. No colour logic lives here.
//
// Invariants that keep imperative DOM edits from being clobbered:
//   • innerHTML is set ONCE via a MODULE-LEVEL {__html} constant (stable
//     identity → React never re-writes it), so class/stroke mutations survive.
//   • Native listeners attach ONCE ([] effect) and read live props through a
//     `latest` ref (no stale closures).
//   • Every effect is idempotent (StrictMode double-invokes them in dev).
// ============================================================================

import { useEffect, useRef } from 'react';
import rawSvg from './FlatCarMap2.svg?raw';
import type { DamageStroke, StrokePoint } from '../types/jobcard';
import { MIN_POINT_DIST, strokeToPathD } from './strokes';

interface Props {
  /** data-panel keys of the currently-selected (damaged) panels. */
  selected: Set<string>;
  /** Persisted freehand strokes (viewBox coords). */
  strokes: DamageStroke[];
  /** 'select' toggles panels on click; 'draw' captures freehand strokes. */
  mode: 'select' | 'draw';
  onToggle: (key: string) => void;
  onStrokeAdd: (stroke: DamageStroke) => void;
  className?: string;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// Stable identity → React sets innerHTML on mount and never clobbers our
// imperative DOM edits on subsequent re-renders.
const HTML = { __html: rawSvg };

function makePath(d: string): SVGPathElement {
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d); // only `d` — styling comes from the SVG's #DrawLayer CSS
  return path;
}

export default function CarMap({ selected, strokes, mode, onToggle, onStrokeAdd, className }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  // Live props for the once-attached native listeners (avoids stale closures).
  const latest = useRef({ mode, onToggle, onStrokeAdd });
  latest.current = { mode, onToggle, onStrokeAdd };

  // In-flight stroke state (never triggers re-render).
  const activePointer = useRef<number | null>(null);
  const points = useRef<StrokePoint[]>([]);
  const livePath = useRef<SVGPathElement | null>(null);

  // Attach native listeners exactly once. ────────────────────────────────────
  useEffect(() => {
    const svg = hostRef.current?.querySelector('svg') as SVGSVGElement | null;
    if (!svg) return;
    const drawLayer = svg.querySelector('#DrawLayer') as SVGGElement | null;

    // clientX/Y → viewBox coords (survives page scroll + browser zoom).
    const toViewBox = (e: PointerEvent): StrokePoint | null => {
      const ctm = svg.getScreenCTM();
      if (!ctm) return null; // hidden svg — drop the event
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const p = pt.matrixTransform(ctm.inverse());
      return [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
    };

    const onClick = (e: MouseEvent) => {
      if (latest.current.mode !== 'select') return;
      const el = (e.target as Element | null)?.closest('[data-panel]');
      const key = el?.getAttribute('data-panel');
      if (key) latest.current.onToggle(key);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (latest.current.mode !== 'draw') return;
      if (activePointer.current !== null) return; // ignore extra simultaneous pointers
      if (!drawLayer) return;
      const p = toViewBox(e);
      if (!p) return;
      e.preventDefault();
      activePointer.current = e.pointerId;
      try {
        svg.setPointerCapture(e.pointerId);
      } catch {
        /* capture may fail (e.g. pointer already released) — draw still works */
      }
      points.current = [p];
      const path = makePath(strokeToPathD(points.current));
      drawLayer.appendChild(path);
      livePath.current = path;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (activePointer.current !== e.pointerId) return;
      const p = toViewBox(e);
      if (!p) return;
      const pts = points.current;
      const last = pts[pts.length - 1];
      if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < MIN_POINT_DIST) return;
      pts.push(p);
      livePath.current?.setAttribute('d', strokeToPathD(pts));
    };

    const finish = (e: PointerEvent) => {
      if (activePointer.current !== e.pointerId) return;
      const pts = points.current;
      activePointer.current = null;
      points.current = [];
      livePath.current = null;
      // Leave the live path in the DOM — the [strokes] effect swaps it in after
      // commit. Removing it here would flash one empty frame (effects run post-paint).
      if (pts.length > 0) latest.current.onStrokeAdd(pts);
    };

    svg.addEventListener('click', onClick);
    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerup', finish);
    svg.addEventListener('pointercancel', finish);
    return () => {
      svg.removeEventListener('click', onClick);
      svg.removeEventListener('pointerdown', onPointerDown);
      svg.removeEventListener('pointermove', onPointerMove);
      svg.removeEventListener('pointerup', finish);
      svg.removeEventListener('pointercancel', finish);
    };
  }, []);

  // Draw mode toggles the SVG's own class (crosshair + touch-action:none). ────
  useEffect(() => {
    const svg = hostRef.current?.querySelector('svg') as SVGSVGElement | null;
    if (!svg) return;
    svg.classList.toggle('draw-mode', mode === 'draw');
    // Leaving draw cancels any mid-flight stroke.
    if (mode !== 'draw' && activePointer.current !== null) {
      livePath.current?.remove();
      livePath.current = null;
      points.current = [];
      activePointer.current = null;
    }
  }, [mode]);

  // Selection → `.selected` class on every matching element (multi-view panels). ─
  useEffect(() => {
    const svg = hostRef.current?.querySelector('svg') as SVGSVGElement | null;
    if (!svg) return;
    svg.querySelectorAll('[data-panel].selected').forEach((el) => el.classList.remove('selected'));
    selected.forEach((key) => {
      svg.querySelectorAll(`[data-panel="${key}"]`).forEach((el) => el.classList.add('selected'));
    });
  }, [selected]);

  // Persisted strokes → repopulate #DrawLayer. ───────────────────────────────
  useEffect(() => {
    const svg = hostRef.current?.querySelector('svg') as SVGSVGElement | null;
    const drawLayer = svg?.querySelector('#DrawLayer') as SVGGElement | null;
    if (!drawLayer) return;
    drawLayer.replaceChildren();
    for (const stroke of strokes) drawLayer.appendChild(makePath(strokeToPathD(stroke)));
    // Keep a mid-flight stroke visible (e.g. Undo tapped by a second finger).
    if (activePointer.current !== null && livePath.current) drawLayer.appendChild(livePath.current);
  }, [strokes]);

  return (
    <div
      ref={hostRef}
      className={`select-none [&_svg]:block [&_svg]:h-auto [&_svg]:w-full${className ? ` ${className}` : ''}`}
      dangerouslySetInnerHTML={HTML}
    />
  );
}
