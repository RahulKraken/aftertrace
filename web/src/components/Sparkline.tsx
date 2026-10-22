import { useId, useRef, useState } from "react"

// A small chart of the last N days: a smooth line that draws itself in, a soft
// gradient under it, today's point marked, and a crosshair with the day and
// value under your pointer. Hover is the signifier that it can be read.
export function Sparkline({
  values,
  labels,
  format,
  width = 96,
  height = 28,
  tone = "ink",
}: {
  values: number[]
  labels?: string[]
  format?: (v: number) => string
  width?: number
  height?: number
  tone?: "ink" | "wait" | "model"
}) {
  const id = useId().replace(/:/g, "")
  const ref = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  if (values.length < 2) return null
  const max = Math.max(...values, 0)
  const pad = 3
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2)
  const y = (v: number) => (max <= 0 ? height - pad : height - pad - (v / max) * (height - pad * 2))
  const pts = values.map((v, i) => [x(i), y(v)] as const)
  const d = smooth(pts)
  const area = `${d} L${x(values.length - 1).toFixed(1)},${height} L${x(0).toFixed(1)},${height} Z`
  const last = values.length - 1
  const pick = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const i = Math.round(((clientX - r.left) / r.width) * (values.length - 1))
    setHover(Math.max(0, Math.min(values.length - 1, i)))
  }
  return (
    <span className="spark-wrap" onMouseLeave={() => setHover(null)}>
      <svg
        ref={ref}
        className={`spark spark-${tone}`}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onMouseMove={(e) => pick(e.clientX)}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="spark-stop-top" />
            <stop offset="100%" className="spark-stop-bottom" />
          </linearGradient>
        </defs>
        <path d={area} className="spark-area" fill={`url(#g${id})`} />
        <path d={d} className="spark-line" pathLength={1} />
        {hover != null ? (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={0} y2={height} className="spark-cross" />
            <circle cx={x(hover)} cy={y(values[hover])} r="2.6" className="spark-dot is-hover" />
          </>
        ) : (
          <circle cx={x(last)} cy={y(values[last])} r="2.2" className="spark-dot" />
        )}
      </svg>
      {hover != null && (labels || format) ? (
        <span className="spark-tip" style={{ left: `${(x(hover) / width) * 100}%` }}>
          {labels?.[hover] ? <span className="mute">{labels[hover]}</span> : null}
          <b>{format ? format(values[hover]) : values[hover]}</b>
        </span>
      ) : null}
    </span>
  )
}

// A monotone-ish curve through the points (Catmull-Rom to Bézier, tension kept
// low so it never overshoots far below zero).
function smooth(p: readonly (readonly [number, number])[]): string {
  let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i]
    const p1 = p[i]
    const p2 = p[i + 1]
    const p3 = p[i + 2] || p2
    const t = 0.16
    const c1x = p1[0] + (p2[0] - p0[0]) * t
    const c1y = p1[1] + (p2[1] - p0[1]) * t
    const c2x = p2[0] - (p3[0] - p1[0]) * t
    const c2y = p2[1] - (p3[1] - p1[1]) * t
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return d
}
