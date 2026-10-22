import type { AskResult, QuerySpec } from "../lib/types"
import {
  askSuggestions,
  findings,
  fields,
  getAsk,
  getCost,
  getTrace,
  range,
  sessionDetail,
  sessions,
} from "./load"
import { mockOverview, mockSources, mockStatus } from "./overview"
import { fieldValues, queryTraces, runQuery } from "./query"
import { runSql } from "./sql"

function json<T>(data: T, status = 200): T {
  if (status >= 400) throw Object.assign(new Error((data as { error?: string }).error || "error"), { payload: data })
  return data
}

export async function handle(path: string, init?: RequestInit): Promise<unknown> {
  const url = new URL(path, "http://aftertrace.local")
  const p = url.pathname
  const method = (init?.method || "GET").toUpperCase()

  if (method === "GET") {
    if (p === "/api/overview") return json(mockOverview())
    if (p === "/api/status") return json(mockStatus())
    if (p === "/api/sources") return json({ now: Date.now() * 1e6, sources: mockSources() })
    if (p === "/api/sessions") return json(sessions)
    if (p.startsWith("/api/session/")) {
      const id = p.split("/").pop() || ""
      const d = sessionDetail(id)
      if (!d) return json({ error: "not found" }, 404)
      return json(d)
    }
    if (p.startsWith("/api/trace/")) {
      const id = p.split("/").pop() || ""
      const t = getTrace(id)
      if (!t) return json({ error: "not found" }, 404)
      return json(t)
    }
    if (p === "/api/findings") return json(findings)
    if (p === "/api/fields") return json(fields)
    if (p === "/api/cost") {
      const dim = url.searchParams.get("dim") || "model"
      const c = getCost(dim)
      if (!c) return json({ error: "unknown dim" }, 400)
      return json(c)
    }
    if (p === "/api/ask/suggestions") return json(askSuggestions)
    if (p === "/api/range") return json(range)
    if (p === "/api/field-values") {
      const field = url.searchParams.get("field") || "name"
      return json(fieldValues(field))
    }
  }

  if (method === "POST") {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    if (p === "/api/query") return json(runQuery(body as unknown as QuerySpec))
    if (p === "/api/query/traces") {
      return json(
        queryTraces(
          body.query as QuerySpec,
          body.group_values as (string | null)[] | undefined,
          body.bucket as [number, number] | undefined,
        ),
      )
    }
    if (p === "/api/sql") return json(runSql(String(body.sql || "")))
    if (p === "/api/ask") {
      const q = String(body.question || "")
      const hit = getAsk(q)
      if (hit) return json(hit)
      const fallback: AskResult = {
        answer:
          "The prototype agent only knows the suggested questions. Set up a model (see spec) for free-form questions.",
        sql: null,
        result: null,
        evidence: [],
        builder: null,
      }
      return json(fallback)
    }
  }

  return json({ error: "not found" }, 404)
}
