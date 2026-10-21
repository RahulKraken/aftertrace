import { dur, pct } from "./format"
import type { Breakdown, Session, Trace } from "./types"

export function sessionStory(s: Session): string {
  const tot = s.turn_ms || 1
  const wait = s.breakdown?.permission_wait || 0
  const waitShare = wait / tot
  const retry = s.breakdown?.retry || 0
  if (waitShare >= 0.08) {
    return `You spent ${pct(waitShare)} of this session waiting on approvals.`
  }
  if (retry > tot * 0.08) {
    return `Retries ate ${dur(retry)} of this session — ${pct(retry / tot)} of wall clock.`
  }
  if ((s.cache_hit ?? 1) < 0.5) {
    return `Cache hit was ${pct(s.cache_hit)}. Most tokens were paid at full price.`
  }
  if (s.findings === 0) {
    return "Quiet session. Nothing to fix — the model spent its time working."
  }
  if (s.agents.length) {
    return `Main thread plus ${s.agents.join(" and ")} — ${s.turns} turns, ${dur(s.turn_ms)}.`
  }
  return `${s.turns} turns, ${dur(s.turn_ms)}, ${pct(s.cache_hit)} cache hit.`
}

export function turnStory(t: Trace): string {
  const root = t.spans.find((s) => s.name === "claude_code.interaction")
  const tot = root?.duration_ms || 1
  const bd = t.breakdown
  const wait = bd?.permission_wait || 0
  const retry = bd?.retry || 0
  if (wait / tot >= 0.08) {
    return `You spent ${pct(wait / tot)} of this turn waiting on approvals.`
  }
  if (retry / tot >= 0.08) {
    return `Retries cost ${dur(retry)} before a successful request.`
  }
  const model = bd?.model || 0
  if (model / tot >= 0.6) {
    return `Most of this turn was the model thinking (${pct(model / tot)}).`
  }
  return `Turn ${t.turn_index} of ${t.turn_count} · ${dur(tot)} of wall clock.`
}

export type WeekPoint = {
  day: string
  wait_s: number
  saved_s: number
  cost: number
  cache_hit: number
}

export type WeekStoryData = {
  headline: string
  saved: string
  cost: string
  cache: string
  savedDelta: string
  costDelta: string
  cacheDelta: string
  series: WeekPoint[]
}

export function weekStory(): { waitPct: number; savedMin: number } {
  return { waitPct: 23, savedMin: 11 }
}

export function weekLine(): string {
  const { waitPct, savedMin } = weekStory()
  return `You spent ${waitPct}% of this week waiting on approvals, and saved ${savedMin} min.`
}

export const WEEK: WeekStoryData = {
  headline: "A quieter week once the git-commit allow rule landed.",
  saved: "11 min",
  cost: "$21.81",
  cache: "93%",
  savedDelta: "after one allow rule",
  costDelta: "−12% vs prior week",
  cacheDelta: "87% → 93%",
  series: [
    { day: "14 Oct", wait_s: 89, saved_s: 0, cost: 8.85, cache_hit: 0.93 },
    { day: "15 Oct", wait_s: 23, saved_s: 0, cost: 4.98, cache_hit: 0.85 },
    { day: "16 Oct", wait_s: 36, saved_s: 0, cost: 9.1, cache_hit: 0.95 },
    { day: "17 Oct", wait_s: 12, saved_s: 180, cost: 8.35, cache_hit: 0.87 },
    { day: "18 Oct", wait_s: 0, saved_s: 420, cost: 6.48, cache_hit: 0.93 },
    { day: "19 Oct", wait_s: 0, saved_s: 660, cost: 0.05, cache_hit: 0.72 },
  ],
}

export function mixShare(bd: Breakdown | null | undefined): number[] {
  if (!bd) return [1, 0, 0, 0, 0, 0]
  const keys: (keyof Breakdown)[] = ["model", "tool", "permission_wait", "retry", "hook", "other"]
  const tot = keys.reduce((a, k) => a + (bd[k] || 0), 0) || 1
  return keys.map((k) => (bd[k] || 0) / tot)
}
