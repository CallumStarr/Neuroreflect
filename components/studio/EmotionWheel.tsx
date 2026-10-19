'use client';

import { useState } from 'react';
import { EMOTION_FAMILIES } from '@/lib/lexicons';

interface Props {
  highlight?: string[]; // family ids to emphasise (from a selected broad word)
  onPick: (term: string) => void;
}

// Affective differentiation wheel: families around the ring, precise terms below.
export default function EmotionWheel({ highlight = [], onPick }: Props) {
  const [selected, setSelected] = useState<string>(highlight[0] ?? EMOTION_FAMILIES[0].id);
  const active = EMOTION_FAMILIES.find((f) => f.id === selected) ?? EMOTION_FAMILIES[0];
  const R = 96;
  const r = 56;
  const cx = 110;
  const cy = 110;
  const n = EMOTION_FAMILIES.length;
  const gap = 0.035; // radians of surface gap between segments

  const arc = (i: number) => {
    const a0 = (i / n) * Math.PI * 2 - Math.PI / 2 + gap;
    const a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2 - gap;
    const p = (rad: number, a: number) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
    const [x0, y0] = p(R, a0);
    const [x1, y1] = p(R, a1);
    const [x2, y2] = p(r, a1);
    const [x3, y3] = p(r, a0);
    const mid = (a0 + a1) / 2;
    const [lx, ly] = p((R + r) / 2, mid);
    return { d: `M${x0},${y0} A${R},${R} 0 0 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 0 0 ${x3},${y3} Z`, lx, ly };
  };

  return (
    <div>
      <svg viewBox="0 0 220 220" className="mx-auto block h-[220px] w-[220px]" role="group" aria-label="Emotion families">
        {EMOTION_FAMILIES.map((f, i) => {
          const { d, lx, ly } = arc(i);
          const isSel = f.id === selected;
          const isHi = highlight.includes(f.id);
          return (
            <g
              key={f.id}
              role="button"
              tabIndex={0}
              aria-pressed={isSel}
              aria-label={f.label}
              onClick={() => setSelected(f.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelected(f.id);
                }
              }}
              className="cursor-pointer outline-none"
            >
              <path d={d} fill={isSel ? '#3b332b' : isHi ? '#2c261f' : '#231e19'} stroke={isSel ? '#e0aa4a' : 'none'} strokeWidth={1.5} />
              <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize={9.5} fill={isSel ? '#efe6d6' : isHi ? '#e3d8c5' : '#93846f'} style={{ pointerEvents: 'none' }}>
                {f.label}
              </text>
            </g>
          );
        })}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize={11} fill="#c4b49b">
          {active.label}
        </text>
        <text x={cx} y={cy + 10} textAnchor="middle" fontSize={9} fill="#93846f">
          {active.terms.length} terms
        </text>
      </svg>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {active.terms.map((t) => (
          <button key={t} type="button" onClick={() => onPick(t)} className="rounded-full border border-ink-700 px-2.5 py-1 text-[12.5px] text-paper-100 hover:border-ember-400 hover:bg-ink-800">
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}
