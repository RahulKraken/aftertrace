import { actionSentence, moneyLabel } from "../lib/welcome"
import { modelName } from "../lib/format"
import type {
  AppDetail,
  AppSummary,
  AskResult,
  Recap,
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

const appFiles = import.meta.glob("./fixtures/apps/*.json", { eager: true, import: "default" }) as Record<string, AppDetail>

import appsJson from "./fixtures/apps.json"
import recap0 from "./fixtures/recap-0.json"
import recap1 from "./fixtures/recap-1.json"
import sessionsJson from "./fixtures/sessions.json"
import findingsJson from "./fixtures/findings.json"
import fieldsJson from "./fixtures/fields.json"
import rangeJson from "./fixtures/range.json"
import askIndexJson from "./fixtures/ask/index.json"
import llmJson from "./fixtures/tables/llm.json"
import toolsJson from "./fixtures/tables/tools.json"
import qSpansJson from "./fixtures/tables/q_spans.json"
import spansJson from "./fixtures/tables/spans.json"

// Synthetic first prompts, so the demo reads like real use.
const TITLES = [
  "Tidy up my zsh aliases and add a git log alias",
  "Set up a pre-commit hook for the dotfiles repo",
  "Fix the flaky orders test and make npm test pass",
  "Generate the monthly PDF report for the dashboard",
  "Customers are getting charged twice when checkout times out. Find out why and fix it (ORD-142).",
  "Why is the checkout page slow? Profile the bundle",
]

export const sessions = (sessionsJson as Session[]).map((s, i) => ({
  ...s,
  title: TITLES[i % TITLES.length],
}))
export const findings = (findingsJson as Finding[]).map((f) => ({
  ...f,
  action: actionSentence(f),
  money_label: moneyLabel(f, ""),
}))
export const fields = fieldsJson as Field[]
export const range = rangeJson as Range

// Generated from the real backend by scripts/gen-app-fixtures.sh.
export const recaps = [recap0, recap1] as unknown as Recap[]

export const apps = appsJson as AppSummary[]

export function appDetail(service: string): AppDetail | undefined {
  return appFiles[`./fixtures/apps/${service}.json`]
}

export function sessionDetail(id: string): SessionDetail | undefined {
  const d = sessionFiles[`./fixtures/sessions/${id}.json`]
  // The list carries the synthetic title; the detail should say the same.
  const listed = sessions.find((s) => s.session_id === id)
  return d && listed ? { ...d, session: { ...d.session, title: listed.title } } : d
}

export function getTrace(id: string): Trace | undefined {
  return traceFiles[`./fixtures/traces/${id}.json`]
}

export function getCost(dim: string): CostTable | undefined {
  const c = costFiles[`./fixtures/cost/${dim}.json`]
  if (!c) return undefined
  const estimated = historyQuery()
  return { ...c, note: mockSpendInsight(), estimated }
}

function historyQuery(): boolean {
  if (typeof window === "undefined") return false
  const hash = window.location.hash || ""
  const q = (hash.split("?")[1] || window.location.search.replace(/^\?/, "")).toString()
  return new URLSearchParams(q).get("history") === "1"
}

function mockSpendInsight(): string {
  const model = costFiles["./fixtures/cost/model.json"]
  const repo = costFiles["./fixtures/cost/repo.json"]
  const top = (table: CostTable | undefined) => {
    const rows = table?.rows || []
    const shareI = table?.columns.indexOf("share") ?? -1
    if (!rows.length || shareI < 0) return { key: "", share: 0 }
    const row = rows[0]
    return { key: String(row[0] ?? ""), share: Number(row[shareI]) || 0 }
  }
  const m = top(model)
  const r = top(repo)
  const estimated = historyQuery()
  const useRepo = r.key && r.share > m.share
  const lead = useRepo ? r.key : modelName(m.key) || m.key
  if (!lead) return estimated ? "No spend this period, estimated from session files." : "No spend this period."
  return estimated ? `${lead} drove most of this period's spend, estimated from session files.` : `${lead} drove most of this period's spend.`
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
