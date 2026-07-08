// ============================================================================
// carMapSvgString — the car map as a self-contained SVG string, for embedding
// in print HTML. Draws the outline (DECOR) + only the SELECTED regions in red.
// ============================================================================

import { DECOR, REGIONS } from './regions';

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === "'" ? '&apos;' : '&quot;',
  );
}

export function carMapSvgString(selected: Set<string>): string {
  const parts: string[] = [];
  parts.push('<svg viewBox="238 -199.2 1072.3 1238.1" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">');
  for (const p of DECOR) parts.push(`<path d="${p.d}" fill="${p.fill}"/>`);
  for (const r of REGIONS) {
    if (!selected.has(r.id)) continue;
    const attrs = 'fill="#ef4444" fill-opacity="0.5" stroke="#dc2626" stroke-width="3"';
    const sh = r.shape;
    if (sh.kind === 'path') {
      parts.push(`<path d="${sh.d}" ${attrs}/>`);
    } else if (sh.kind === 'polygon') {
      parts.push(`<polygon points="${sh.points}" ${attrs}/>`);
    } else {
      parts.push(`<rect x="${sh.x}" y="${sh.y}" width="${sh.w}" height="${sh.h}" rx="${sh.rx || 0}" ${attrs}/>`);
      if (r.labelInside) {
        parts.push(
          `<text x="${sh.x + sh.w / 2}" y="${sh.y + sh.h / 2}" text-anchor="middle" dominant-baseline="central" font-size="26" font-family="sans-serif" font-weight="600" fill="#1e293b">${escapeXml(r.label)}</text>`,
        );
      }
    }
  }
  parts.push('</svg>');
  return parts.join('');
}
