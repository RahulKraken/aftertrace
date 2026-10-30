import { pct, sayDur } from "./format"
import { spanKind, type SpanNode } from "./span"
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
    return `Retries ate ${sayDur(retry)} of this session — ${pct(retry / tot)} of wall clock.`
  }
  if ((s.cache_hit ?? 1) < 0.5) {
    return `Cache hit was ${pct(s.cache_hit)}. Most tokens were paid at full price.`
  }
  if (s.findings === 0) {
    return "Quiet session. Nothing to fix — the model spent its time working."
  }
  if (s.agents.length) {
    return `Main thread plus ${s.agents.join(" and ")} — ${s.turns} turns, ${sayDur(s.turn_ms)}.`
  }
  return `${s.turns} turns, ${sayDur(s.turn_ms)}, ${pct(s.cache_hit)} cache hit.`
}

export function turnStory(t: Trace): string {
  const root = t.spans.find((s) => s.name === "claude_code.interaction")
  const tot = root?.duration_ms || 1
  const bd = t.breakdown
  const wait = bd?.permission_wait || 0
  const retry = bd?.retry || 0
  // AskUserQuestion holds the turn the same way a permission prompt does, but
  // it is Claude asking you something, not you approving a tool.
  const asks = t.spans.filter((s) => s.name === "claude_code.tool" && s.attrs.tool_name === "AskUserQuestion")
  const askIds = new Set(asks.map((s) => s.span_id))
  const askWait = t.spans
    .filter((s) => s.name === "claude_code.tool.blocked_on_user" && askIds.has(s.parent_span_id || ""))
    .reduce((n, s) => n + s.duration_ms, 0)
  if (askWait / tot >= 0.08 && askWait >= wait - askWait) {
    const work = Math.max(tot - wait, 0)
    const what = asks.length === 1 ? "your answer" : `your answers to ${asks.length} questions`
    return `Claude waited ${sayDur(askWait)} for ${what}. The work itself took ${sayDur(work)}.`
  }
  if (wait / tot >= 0.08) {
    return `You spent ${pct(wait / tot)} of this turn approving tool calls.`
  }
  if (retry / tot >= 0.08) {
    return `Retries cost ${sayDur(retry)} before a successful request.`
  }
  const model = bd?.model || 0
  if (model / tot >= 0.6) {
    return `Most of this turn was the model thinking (${pct(model / tot)}).`
  }
  return `Turn ${t.turn_index} of ${t.turn_count} · ${sayDur(tot)} of wall clock.`
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
  // Automatic permission checks are not your time; the mini bar folds them into "other".
  const v = { ...bd, other: (bd.other || 0) + (bd.permission_check || 0) }
  const keys: (keyof Breakdown)[] = ["model", "tool", "permission_wait", "retry", "hook", "other"]
  const tot = keys.reduce((a, k) => a + (v[k] || 0), 0) || 1
  return keys.map((k) => (v[k] || 0) / tot)
}

// One line for an app request: how much of it was model calls.
export function appStory(root: SpanNode): string {
  const calls: SpanNode[] = []
  let errors = 0
  const walk = (n: SpanNode) => {
    if (n.is_error) errors++
    if (spanKind(n) === "model" && !n.name.startsWith("claude_code.")) calls.push(n)
    n.kids.forEach(walk)
  }
  walk(root)
  const total = root.duration_ms || 1
  // Union of call intervals, so parallel calls count once.
  const iv = calls.map((c) => [c.start_ns, c.end_ns] as [number, number]).sort((a, b) => a[0] - b[0])
  let modelNs = 0
  let curS = -1
  let curE = -1
  for (const [a, b] of iv) {
    if (a > curE) {
      if (curE > curS) modelNs += curE - curS
      curS = a
      curE = b
    } else curE = Math.max(curE, b)
  }
  if (curE > curS) modelNs += curE - curS
  const share = modelNs / 1e6 / total
  const head = calls.length
    ? `${calls.length} model ${calls.length === 1 ? "call" : "calls"} took ${pct(Math.min(share, 1))} of this ${sayDur(total)} request.`
    : `${sayDur(total)}, no model calls in this trace.`
  return errors ? `${head} ${errors} ${errors === 1 ? "span" : "spans"} failed.` : head
}
