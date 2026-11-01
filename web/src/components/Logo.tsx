// Settle mark: loud first spike, damped decay, calm line, amber dot.
// Small drawings (16 / 32) — not a scaled-down master. Stroke follows the
// theme via currentColor (ink on light, cream on dark).
const AMBER = "#E29A2E"

const DRAWING_16 = {
  box: 16,
  d: "M3.5 8 L5 4 L7 12 L8.5 8 L10.5 8",
  sw: 1.5,
  cx: 11.4,
  cy: 8,
  r: 1.8,
}

const DRAWING_32 = {
  box: 32,
  d: "M6.5 16 L8.5 8 L11.5 23 L14 12.5 L16.5 16 L23.5 16",
  sw: 2,
  cx: 25,
  cy: 16,
  r: 2.7,
}

export function Logo({ size = 18 }: { size?: number }) {
  const m = size <= 24 ? DRAWING_16 : DRAWING_32
  return (
    <svg className="logo" width={size} height={size} viewBox={`0 0 ${m.box} ${m.box}`} fill="none" aria-hidden="true">
      <path d={m.d} stroke="currentColor" strokeWidth={m.sw} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={m.cx} cy={m.cy} r={m.r} fill={AMBER} />
    </svg>
  )
}
