export type DayTick = { i: number; label: string }

// Left edge of bar i in a row of `count` equal slots. Shared by Home and Recap
// so weekday ticks sit under their bars instead of a Figma leftover offset.
export function barSlot(width: number, count: number, i: number, barW: number, pad = 8): number {
  const n = Math.max(count, 1)
  const inner = Math.max(width - pad * 2, barW)
  const slot = inner / n
  return pad + i * slot + (slot - barW) / 2
}

// Keep the first and last x-axis labels; drop any in-between tick whose
// label would overlap a neighbour (or the ends).
export function labelDays(
  days: { start_ns: number }[],
  innerWidth = 658,
): DayTick[] {
  if (!days.length) return []
  const last = days.length - 1
  const labelOf = (i: number) =>
    new Date(days[i].start_ns / 1e6).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
  if (last === 0) return [{ i: 0, label: labelOf(0) }]
  const gap = innerWidth / Math.max(days.length, 1)
  const minIdx = Math.max(1, Math.ceil(56 / gap))
  const step = Math.max(minIdx, Math.floor(last / 4) || 1)
  const picks = [0]
  for (let i = step; i < last; i += step) {
    if (i - picks[picks.length - 1] >= minIdx && last - i >= minIdx) picks.push(i)
  }
  picks.push(last)
  return picks.map((i) => ({ i, label: labelOf(i) }))
}

// Last tick is always >= max so stacked bars stay inside the plot instead of
// painting through the card header (the old loop used `t < max * 1.05`).
export function niceAxis(max: number, tokens = false): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1]
  if (tokens) {
    const step = max > 5e6 ? 5e6 : max > 1e6 ? 1e6 : 2e5
    const out = [0]
    for (let t = step; t < max * 1.05; t += step) out.push(t)
    if (out[out.length - 1] < max) out.push(out[out.length - 1] + step)
    return out
  }
  const nice = [1, 2, 3, 5, 10, 20, 30, 50, 100]
  const step = nice.find((n) => max / n <= 3) || Math.ceil(max / 3)
  const out = [0]
  for (let t = step; t < max * 1.05; t += step) out.push(t)
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step)
  if (out.length < 2) out.push(step)
  return out
}
