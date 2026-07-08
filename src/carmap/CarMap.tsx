// ============================================================================
// CarMap — generic, data-driven top-down body diagram.
// Renders the decorative outline (DECOR) + interactive regions (REGIONS).
// Clicking a region calls onToggle(id); selected regions fill red.
// ============================================================================

import { useState } from 'react';
import { DECOR, REGIONS, type CarRegion, type RegionShape } from './regions';

interface Props {
  /** Ids of the currently-selected (damaged) regions. */
  selected: Set<string>;
  onToggle: (id: string) => void;
  /** Override the region set (defaults to REGIONS). */
  regions?: CarRegion[];
  className?: string;
  /** Read-only render (no click / hover), e.g. for a print preview. */
  readOnly?: boolean;
}

const VIEWBOX = '238 -199.2 1072.3 1238.1';

export default function CarMap({ selected, onToggle, regions = REGIONS, className, readOnly }: Props) {
  const [hover, setHover] = useState<string | null>(null);

  const fillFor = (id: string) => (selected.has(id) ? '#ef4444' : '#3b82f6');
  const opacityFor = (id: string) => {
    const on = selected.has(id);
    if (hover === id && !readOnly) return on ? 0.62 : 0.42;
    return on ? 0.42 : 0.16;
  };

  const commonProps = (r: CarRegion) => ({
    fill: fillFor(r.id),
    style: {
      opacity: opacityFor(r.id),
      cursor: readOnly ? 'default' : 'pointer',
      transition: 'opacity 0.15s ease',
    } as React.CSSProperties,
    stroke: selected.has(r.id) ? '#dc2626' : 'transparent',
    strokeWidth: 2,
    onClick: readOnly ? undefined : () => onToggle(r.id),
    onMouseEnter: readOnly ? undefined : () => setHover(r.id),
    onMouseLeave: readOnly ? undefined : () => setHover(null),
  });

  const renderShape = (r: CarRegion, shape: RegionShape) => {
    const cp = commonProps(r);
    switch (shape.kind) {
      case 'path':
        return <path key={r.id} d={shape.d} {...cp}><title>{r.label}</title></path>;
      case 'polygon':
        return <polygon key={r.id} points={shape.points} {...cp}><title>{r.label}</title></polygon>;
      case 'rect':
        return (
          <g key={r.id}>
            <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.rx} {...cp}>
              <title>{r.label}</title>
            </rect>
            {r.labelInside && (
              <text
                x={shape.x + shape.w / 2}
                y={shape.y + shape.h / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={26}
                fill="#1e293b"
                style={{ pointerEvents: 'none', userSelect: 'none', fontWeight: 600 }}
              >
                {r.label}
              </text>
            )}
          </g>
        );
    }
  };

  return (
    <svg viewBox={VIEWBOX} xmlns="http://www.w3.org/2000/svg" className={className} style={{ width: '100%', height: 'auto', touchAction: 'manipulation' }}>
      {DECOR.map((p, i) => (
        <path key={`decor-${i}`} d={p.d} fill={p.fill} />
      ))}
      {regions.map((r) => renderShape(r, r.shape))}
    </svg>
  );
}
