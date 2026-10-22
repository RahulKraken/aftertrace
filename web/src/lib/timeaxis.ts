// A time axis that can fold long idle stretches (a person away for half an
// hour) into a short labelled break, so the work on either side stays legible.
export type Gap = { a: number; b: number; label: string }
export type Axis = {
  toPct: (ns: number) => number
  toNs: (pct: number) => number
  breaks: { a: number; b: number; at: number; w: number; label: string }[]
}

// Share of the axis one folded gap takes.
const GAP_PCT = 3.5

export function linearAxis(lo: number, hi: number): Axis {
  const span = Math.max(hi - lo, 1)
  return { toPct: (ns) => ((ns - lo) / span) * 100, toNs: (p) => lo + (p / 100) * span, breaks: [] }
}

export function foldedAxis(lo: number, hi: number, gaps: Gap[]): Axis {
  const clipped = mergeGaps(gaps)
    .map((g) => ({ ...g, a: Math.max(g.a, lo), b: Math.min(g.b, hi) }))
    .filter((g) => g.b > g.a)
  if (!clipped.length) return linearAxis(lo, hi)
  const folded = clipped.reduce((n, g) => n + (g.b - g.a), 0)
  const live = Math.max(hi - lo - folded, 1)
  const usable = Math.max(100 - clipped.length * GAP_PCT, 20)
  const per = usable / live
  // Breakpoints: [ns, pct] pairs the mapping interpolates between.
  const pts: [number, number][] = [[lo, 0]]
  const breaks: Axis["breaks"] = []
  let pct = 0
  let at = lo
  for (const g of clipped) {
    pct += (g.a - at) * per
    pts.push([g.a, pct])
    breaks.push({ a: g.a, b: g.b, at: pct, w: GAP_PCT, label: g.label })
    pct += GAP_PCT
    pts.push([g.b, pct])
    at = g.b
  }
  pts.push([hi, pct + (hi - at) * per])
  const toPct = (ns: number) => {
    if (ns <= lo) return ((ns - lo) * per)
    for (let i = 1; i < pts.length; i++) {
      const [n1, p1] = pts[i]
      const [n0, p0] = pts[i - 1]
      if (ns <= n1) return n1 === n0 ? p1 : p0 + ((ns - n0) / (n1 - n0)) * (p1 - p0)
    }
    return pts[pts.length - 1][1] + (ns - hi) * per
  }
  const toNs = (p: number) => {
    for (let i = 1; i < pts.length; i++) {
      const [n1, p1] = pts[i]
      const [n0, p0] = pts[i - 1]
      if (p <= p1) return p1 === p0 ? n1 : n0 + ((p - p0) / (p1 - p0)) * (n1 - n0)
    }
    return hi
  }
  return { toPct, toNs, breaks }
}

function mergeGaps(gaps: Gap[]): Gap[] {
  const s = [...gaps].sort((x, y) => x.a - y.a)
  const out: Gap[] = []
  for (const g of s) {
    const last = out[out.length - 1]
    if (last && g.a <= last.b) {
      last.b = Math.max(last.b, g.b)
    } else out.push({ ...g })
  }
  return out
}
