export type DayTick = { i: number; label: string }

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
