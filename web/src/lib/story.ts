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

const WEEK_NS = 7 * 24 * 3600 * 1e9

// Share of turn time spent waiting on permission prompts, over the 7 days
// ending at the newest session. Anchoring on the data, not the clock, keeps
// the number stable for old imports and for fixtures.
export function weekStory(rows: Session[], now = Date.now()): {
  waitPct: number
  sessions: number
  costUsd: number
  thisWeek: boolean
} {
  if (!rows.length) return { waitPct: 0, sessions: 0, costUsd: 0, thisWeek: false }
  const anchor = Math.max(...rows.map((r) => r.start_ns))
  const week = rows.filter((r) => r.start_ns >= anchor - WEEK_NS)
  let wait = 0
  let turn = 0
  let cost = 0
  for (const r of week) {
    wait += r.breakdown?.permission_wait || 0
    turn += r.turn_ms || 0
    cost += r.cost_usd || 0
  }
  return {
    waitPct: turn > 0 ? Math.round((100 * wait) / turn) : 0,
    sessions: week.length,
    costUsd: cost,
    thisWeek: now * 1e6 - anchor < WEEK_NS,
  }
}

export function mixShare(bd: Breakdown | null | undefined): number[] {
  if (!bd) return [1, 0, 0, 0, 0, 0]
  const keys: (keyof Breakdown)[] = ["model", "tool", "permission_wait", "retry", "hook", "other"]
  const tot = keys.reduce((a, k) => a + (bd[k] || 0), 0) || 1
  return keys.map((k) => (bd[k] || 0) / tot)
}
