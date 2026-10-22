import type { Breakdown, DayPoint, LiveLane, Overview, Source, Status, WindowStats } from "../lib/types"
import { apps, findings, sessions } from "./load"
import llmJson from "./fixtures/tables/llm.json"
import spansJson from "./fixtures/tables/spans.json"

// The demo build has no server. These are computed from the same synthetic
// fixtures the other pages use; the few numbers the demo generator does not
// produce (lines, commits, the previous week) are fixed synthetic values.
const DAY = 86400e9
type Table = { columns: string[]; rows: unknown[][] }

function col(t: Table, name: string): unknown[] {
  const i = t.columns.indexOf(name)
  return i < 0 ? [] : t.rows.map((r) => r[i])
}

const ZERO: Breakdown = { model: 0, tool: 0, permission_wait: 0, retry: 0, hook: 0, permission_check: 0, other: 0 }

function addBd(a: Breakdown, b: Breakdown | null): Breakdown {
  if (!b) return a
  const out = { ...a }
  for (const k of Object.keys(ZERO) as (keyof Breakdown)[]) out[k] = (out[k] || 0) + (b[k] || 0)
  return out
}

export function mockOverview(): Overview {
  const hi = Math.max(...sessions.map((s) => s.end_ns)) + 1
  const lo = hi - 7 * DAY
  const inWeek = sessions.filter((s) => s.start_ns >= lo)
  const llm = llmJson as Table
  const starts = col(llm, "start_ns") as number[]
  const costs = col(llm, "cost_usd") as (number | null)[]
  let bd = { ...ZERO }
  for (const s of inWeek) bd = addBd(bd, s.breakdown)
  const week: WindowStats = {
    sessions: inWeek.length,
    turns: inWeek.reduce((a, s) => a + s.turns, 0),
    turn_ms: inWeek.reduce((a, s) => a + s.turn_ms, 0),
    breakdown: bd,
    cost_usd: inWeek.reduce((a, s) => a + (s.cost_usd || 0), 0),
    requests: starts.filter((t) => t >= lo).length,
    tokens: inWeek.reduce((a, s) => a + (s.tokens || 0), 0),
    cache_hit: 0.91,
    lines_added: 2184,
    lines_removed: 391,
    commits: 11,
    pull_requests: 3,
    active_s: 5400,
    tool_calls: 211,
    approvals: 14,
    errors: inWeek.reduce((a, s) => a + s.errors, 0),
  }
  const prev: WindowStats = {
    ...week,
    turn_ms: week.turn_ms * 0.82,
    breakdown: { ...bd, permission_wait: (bd.permission_wait || 0) * 1.6 },
    cost_usd: week.cost_usd * 0.9,
    lines_added: 1610,
  }
  const first = new Date(hi / 1e6)
  first.setHours(0, 0, 0, 0)
  first.setDate(first.getDate() - 13)
  const days: DayPoint[] = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(first)
    d.setDate(first.getDate() + i)
    return { day: d.toDateString(), start_ns: d.getTime() * 1e6, cost_usd: 0, turn_ms: 0, wait_ms: 0, turns: 0 }
  })
  const idx = (ns: number) => {
    for (let i = days.length - 1; i >= 0; i--) if (ns >= days[i].start_ns) return i
    return -1
  }
  for (const s of sessions) {
    const i = idx(s.start_ns)
    if (i < 0) continue
    days[i].turns += s.turns
    days[i].turn_ms += s.turn_ms
    days[i].wait_ms += s.breakdown?.permission_wait || 0
  }
  starts.forEach((t, j) => {
    const i = idx(t)
    if (i >= 0) days[i].cost_usd += costs[j] || 0
  })
  const recent = [...sessions].sort((a, b) => b.start_ns - a.start_ns).slice(0, 6)
  const now = Date.now() * 1e6
  const lead = recent[0]
  const live: LiveLane[] = lead
    ? [
        {
          session_id: lead.session_id,
          trace_id: firstTrace(),
          title: lead.title || null,
          source: "claude-code",
          start_ns: now - 252e9,
          last_ns: now - 3e9,
          spans: 38,
          cost_usd: 0.41,
          doing: "Bash · npm test -- --watch=false",
          quiet: false,
        },
      ]
    : []
  return {
    now,
    lo,
    hi,
    anchored: true,
    week,
    prev,
    days,
    live,
    sources: mockSources(),
    top: findings[0] || null,
    open: findings.length,
    recent,
    has_data: true,
  }
}

function firstTrace(): string {
  const t = spansJson as Table
  return String(col(t, "trace_id")[0] || "")
}

export function mockSources(): Source[] {
  const now = Date.now() * 1e6
  const spans = (spansJson as Table).rows.length
  return [
    { name: "claude-code", kind: "claude-code", spans, events: 549, metrics: 764, first_ns: now - 9 * DAY, last_ns: now - 3e9, live: true },
    ...apps.map((a, i) => ({ name: a.service, kind: "app" as const, spans: a.spans, events: 0, metrics: 0, first_ns: a.first_ns, last_ns: now - (i + 1) * 3600e9, live: false })),
  ]
}

export function mockStatus(): Status {
  const now = Date.now() * 1e6
  return {
    now,
    info: { version: "demo", db_path: "(in-browser demo data)", store_content: false, otlp_grpc: "127.0.0.1:4317", otlp_http: "127.0.0.1:4318", ui: "", service: "" },
    ask: { enabled: true, model: "canned answers" },
    counts: { Spans: (spansJson as Table).rows.length, SpanEvents: 169, Events: 549, MetricPoints: 764 },
    running: 1,
    sessions: sessions.length,
    findings: findings.length,
    apps: apps.length,
    sources: 1 + apps.length,
    last_ns: now - 3e9,
  }
}
