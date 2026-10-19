import type { NodeKind } from '@/lib/types';

export type Kind = NodeKind | 'entry';

// Three validated hues (all-pairs CVD-safe on this surface) plus neutral for
// entries; shape and always-on labels carry identity alongside colour.
export const KIND_STYLE: Record<Kind, { color: string; label: string; singular: string; shape: 'circle' | 'diamond' | 'square' | 'triangle' | 'ring' | 'entry' }> = {
  entry: { color: '#93846f', label: 'Entries', singular: 'Entry', shape: 'entry' },
  person: { color: '#6f93d9', label: 'People', singular: 'Person', shape: 'circle' },
  theme: { color: '#bf8a30', label: 'Themes', singular: 'Theme', shape: 'diamond' },
  value: { color: '#bf8a30', label: 'Values', singular: 'Value', shape: 'square' },
  distortion: { color: '#d0658f', label: 'Thinking patterns', singular: 'Thinking pattern', shape: 'triangle' },
  pattern: { color: '#d0658f', label: 'Loops', singular: 'Loop', shape: 'ring' },
};

export const NODE_KINDS: NodeKind[] = ['person', 'theme', 'value', 'distortion', 'pattern'];

/** A mark of the given kind centred on (x, y), size r in SVG units. */
export function KindMark({ kind, x, y, r, opacity = 1 }: { kind: Kind; x: number; y: number; r: number; opacity?: number }) {
  const s = KIND_STYLE[kind];
  const c = s.color;
  switch (s.shape) {
    case 'circle':
      return <circle cx={x} cy={y} r={r} fill={c} opacity={opacity} />;
    case 'diamond':
      return <path d={`M${x} ${y - r * 1.2} L${x + r * 1.2} ${y} L${x} ${y + r * 1.2} L${x - r * 1.2} ${y} Z`} fill={c} opacity={opacity} />;
    case 'square':
      return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} rx={1.5} fill={c} opacity={opacity} />;
    case 'triangle':
      return <path d={`M${x} ${y - r * 1.15} L${x + r * 1.15} ${y + r * 0.9} L${x - r * 1.15} ${y + r * 0.9} Z`} fill={c} opacity={opacity} />;
    case 'ring':
      return <circle cx={x} cy={y} r={r - 1} fill="none" stroke={c} strokeWidth={2.5} opacity={opacity} />;
    default:
      return <rect x={x - r * 0.55} y={y - r * 1.3} width={r * 1.1} height={r * 2.6} rx={1.5} fill={c} opacity={opacity} />;
  }
}

export function LegendShape({ kind }: { kind: Kind }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="shrink-0">
      <KindMark kind={kind} x={7} y={7} r={kind === 'entry' ? 4 : 5} />
    </svg>
  );
}
