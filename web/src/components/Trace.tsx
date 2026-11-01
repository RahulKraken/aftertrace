import { useMemo } from "react"

/** One spike per turn, height = cost, alternating up/down. Amber dot if it has a finding. */
export function Trace({
  turns,
  width = 160,
  height = 22,
  max,
  len = 1,
  flag = false,
  live = false,
  stroke,
  r = 3,
  sw = 1.5,
}: {
  turns: number[]
  width?: number
  height?: number
  max?: number
  len?: number
  flag?: boolean
  live?: boolean
  stroke?: string
  r?: number
  sw?: number
}) {
  const d = useMemo(() => {
    const v = turns.length ? turns : [0]
    const mx = max && max > 0 ? max : Math.max(...v, 0.001)
    const mid = height / 2
    const end = Math.max(r * 6, width * Math.max(0.12, Math.min(len, 1)) - r - 1)
    const run = end - r * 3
    const step = run / (v.length + 1)
    let path = `M${sw} ${mid}`
    v.forEach((x, i) => {
      const a = Math.max(0.6, (x / mx) * (mid - sw - 0.5))
      path += ` L${(sw + step * (i + 1)).toFixed(1)} ${(mid + (i % 2 ? a : -a)).toFixed(1)}`
    })
    path += ` L${(sw + step * (v.length + 1)).toFixed(1)} ${mid} L${end - r - 2} ${mid}`
    return { path, end, mid }
  }, [turns, width, height, max, len, r, sw])
  const col = stroke || "var(--ink-2)"
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  return (
    <svg className="tr" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={d.path} fill="none" stroke={col} strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round" />
      {live && !reduce ? <circle className="tr-live" cx={d.end} cy={d.mid} r={r + 3.5} fill="var(--amber)" opacity="0.22" /> : null}
      <circle cx={d.end} cy={d.mid} r={r} fill={flag || live ? "var(--amber)" : col} />
    </svg>
  )
}

/** Stable fake turn costs from a session's total, for list traces when we don't have per-turn rows. */
export function turnsFromSession(id: string, n: number, cost: number): number[] {
  const count = Math.max(1, Math.min(n || 1, 40))
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  const out: number[] = []
  let sum = 0
  for (let i = 0; i < count; i++) {
    h = Math.imul(h, 1664525) + 1013904223
    const v = 0.18 + (((h >>> 0) % 1000) / 1000) * 2.4
    out.push(v)
    sum += v
  }
  const scale = (cost || 1) / (sum || 1)
  return out.map((v) => v * scale)
}
