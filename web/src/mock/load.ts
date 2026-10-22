import type {
  AskResult,
  AskSuggestions,
  CostTable,
  Field,
  Finding,
  QueryResult,
  Range,
  Session,
  SessionDetail,
  Trace,
  TraceHit,
} from "../lib/types"

const sessionFiles = import.meta.glob("./fixtures/sessions/*.json", { eager: true, import: "default" }) as Record<
  string,
  SessionDetail
>
const traceFiles = import.meta.glob("./fixtures/traces/*.json", { eager: true, import: "default" }) as Record<
  string,
  Trace
>
const costFiles = import.meta.glob("./fixtures/cost/*.json", { eager: true, import: "default" }) as Record<
  string,
  CostTable
>
const askFiles = import.meta.glob("./fixtures/ask/*.json", { eager: true, import: "default" }) as Record<string, unknown>

import sessionsJson from "./fixtures/sessions.json"
import findingsJson from "./fixtures/findings.json"
import fieldsJson from "./fixtures/fields.json"
import rangeJson from "./fixtures/range.json"
import askIndexJson from "./fixtures/ask/index.json"
import llmJson from "./fixtures/tables/llm.json"
import toolsJson from "./fixtures/tables/tools.json"
import qSpansJson from "./fixtures/tables/q_spans.json"
import spansJson from "./fixtures/tables/spans.json"

// Synthetic first prompts, so the demo reads like real use. Keyed by repo.
// Synthetic first prompts, so the demo reads like real use.
const TITLES = [
  "Tidy up my zsh aliases and add a git log alias",
  "Set up a pre-commit hook for the dotfiles repo",
  "Fix the flaky orders test and make npm test pass",
  "Generate the monthly PDF report for the dashboard",
  "Add rate limiting to the /v1/orders endpoint",
  "Why is the checkout page slow? Profile the bundle",
]

export const sessions = (sessionsJson as Session[]).map((s, i) => ({
  ...s,
  title: TITLES[i % TITLES.length],
}))
export const findings = findingsJson as Finding[]
export const fields = fieldsJson as Field[]
export const range = rangeJson as Range

export function sessionDetail(id: string): SessionDetail | undefined {
  return sessionFiles[`./fixtures/sessions/${id}.json`]
}

export function getTrace(id: string): Trace | undefined {
  return traceFiles[`./fixtures/traces/${id}.json`]
}

export function getCost(dim: string): CostTable | undefined {
  return costFiles[`./fixtures/cost/${dim}.json`]
}

const askIndex = askIndexJson as Record<string, string>

export const askSuggestions = askFiles["./fixtures/ask/suggestions.json"] as AskSuggestions

export function getAsk(question: string): AskResult | undefined {
  const exact = askIndex[question]
  if (exact) return askFiles[`./fixtures/ask/${exact}`] as AskResult
  const q = question.toLowerCase()
  for (const [full, file] of Object.entries(askIndex)) {
    const keys =
      full.includes("slow")
        ? ["slow"]
        : full.includes("skill")
          ? ["skill"]
          : full.includes("permission") || full.includes("wait")
            ? ["permission", "prompt", "wait"]
            : full.includes("retr")
              ? ["retr"]
              : []
    if (full === question || keys.some((k) => q.includes(k))) {
      return askFiles[`./fixtures/ask/${file}`] as AskResult
    }
  }
  return undefined
}

export type ColTable = { columns: string[]; rows: unknown[][] }

export const tables: Record<string, ColTable> = {
  llm: llmJson as ColTable,
  tools: toolsJson as ColTable,
  q_spans: qSpansJson as ColTable,
  spans: spansJson as ColTable,
}

export type FlatSpan = {
  trace_id: string
  span_id: string
  parent_span_id: string | null
  name: string
  start_ns: number
  end_ns: number
  duration_ms: number
  is_error: boolean
  session_id: string
  attrs: Record<string, unknown>
  event_attrs: Record<string, unknown> | null
  cost_usd: number | null
}

function parseJson(v: unknown): Record<string, unknown> | null {
  if (v == null) return null
  if (typeof v === "object") return v as Record<string, unknown>
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as Record<string, unknown>
    } catch {
      return null
    }
  }
  return null
}

export const qSpans: FlatSpan[] = (qSpansJson as ColTable).rows.map((r) => {
  const o: Record<string, unknown> = {}
  ;(qSpansJson as ColTable).columns.forEach((c, i) => {
    o[c] = r[i]
  })
  return {
    trace_id: String(o.trace_id),
    span_id: String(o.span_id),
    parent_span_id: (o.parent_span_id as string) || null,
    name: String(o.name),
    start_ns: Number(o.start_ns),
    end_ns: Number(o.end_ns),
    duration_ms: Number(o.duration_ms),
    is_error: Boolean(o.is_error),
    session_id: String(o.session_id),
    attrs: parseJson(o.attrs) || {},
    event_attrs: parseJson(o.event_attrs),
    cost_usd: o.cost_usd == null ? null : Number(o.cost_usd),
  }
})

export function tableRows(name: string): Record<string, unknown>[] {
  const t = tables[name]
  if (!t) return []
  return t.rows.map((r) => {
    const o: Record<string, unknown> = {}
    t.columns.forEach((c, i) => {
      o[c] = r[i]
    })
    if (typeof o.attrs === "string") o.attrs = parseJson(o.attrs)
    if (typeof o.event_attrs === "string") o.event_attrs = parseJson(o.event_attrs)
    return o
  })
}

export function allTracesForHits(): Map<string, { session_id: string; start_ns: number; duration_ms: number; repo: string | null }> {
  const m = new Map<string, { session_id: string; start_ns: number; duration_ms: number; repo: string | null }>()
  for (const s of sessions) {
    const d = sessionDetail(s.session_id)
    if (!d) continue
    for (const t of d.turns) {
      m.set(t.trace_id, {
        session_id: s.session_id,
        start_ns: t.start_ns,
        duration_ms: t.duration_ms,
        repo: s.repo,
      })
    }
  }
  return m
}

export type { TraceHit, QueryResult }
