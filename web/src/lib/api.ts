import type {
  AppDetail,
  AppSummary,
  AskResult,
  AskSuggestions,
  CostTable,
  Field,
  Finding,
  QueryResult,
  QuerySpec,
  Overview,
  Range,
  Recap,
  Session,
  Source,
  Status,
  SessionDetail,
  SqlResult,
  Trace,
  TraceHit,
} from "./types"
import { RETRY_EVENT } from "./poll"

const mockOn = import.meta.env.VITE_USE_MOCK !== "0"
const base = import.meta.env.VITE_API_BASE || ""

const DRIVER = /sql:|database is closed|duckdb|out of memory|constraint|binder error|catalog error|io error|invalid error/i

export type ApiError = Error & { status?: number; code?: string; transient?: boolean }

let reconnecting = false
const reconnectListeners = new Set<(on: boolean) => void>()
let reconnectTurn: { failed: boolean } | null = null

export function isReconnecting(): boolean {
  return reconnecting
}

export function onReconnect(fn: (on: boolean) => void): () => void {
  reconnectListeners.add(fn)
  fn(reconnecting)
  return () => {
    reconnectListeners.delete(fn)
  }
}

function setReconnecting(on: boolean) {
  if (reconnecting === on) return
  reconnecting = on
  for (const fn of reconnectListeners) {
    try {
      fn(on)
    } catch {
      /* subscriber */
    }
  }
}

function noteReconnect(failed: boolean) {
  if (!reconnectTurn) {
    reconnectTurn = { failed }
    queueMicrotask(() => {
      const turn = reconnectTurn
      reconnectTurn = null
      if (!turn) return
      setReconnecting(turn.failed)
    })
  } else if (failed) {
    reconnectTurn.failed = true
  }
}

export function isTransientError(e: unknown): boolean {
  const err = e as ApiError | undefined
  if (!err) return false
  if (err.transient) return true
  if (err.status === 503 || err.status === 0) return true
  if (err.code === "restarting") return true
  const m = String(err.message || "")
  return /restarting|failed to fetch|networkerror|load failed|econnrefused|database is closed|out of memory/i.test(m)
}

export function publicErrorMessage(e: unknown): string {
  if (isTransientError(e)) return "restarting"
  const m = String((e as Error)?.message || "")
  if (DRIVER.test(m)) return "restarting"
  return m || "request failed"
}

function makeError(data: { error?: string; code?: string } | undefined, status: number, cause?: unknown): ApiError {
  const raw = String((data && data.error) || (cause instanceof Error ? cause.message : "") || "")
  const code = data?.code
  const transient =
    status === 503 ||
    status === 0 ||
    code === "restarting" ||
    /database is closed|failed to fetch|networkerror|econnrefused/i.test(raw)
  const hide = transient || DRIVER.test(raw)
  const err = new Error(hide ? "restarting" : raw || "request failed") as ApiError
  err.status = status
  err.code = code || (transient ? "restarting" : undefined)
  err.transient = transient || hide
  return err
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    if (mockOn) {
      const { handle } = await import("../mock/handler")
      try {
        const out = (await handle(base + path, init)) as T
        noteReconnect(false)
        return out
      } catch (e) {
        const payload = (e as { payload?: { error?: string; code?: string } }).payload
        const status = (e as { status?: number }).status ?? (payload ? 400 : 0)
        throw makeError(payload, status, e)
      }
    }
    const res = await fetch(base + path, {
      ...init,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    })
    let data: (T & { error?: string; code?: string }) | undefined
    try {
      data = (await res.json()) as T & { error?: string; code?: string }
    } catch {
      data = undefined
    }
    if (!res.ok) throw makeError(data, res.status)
    noteReconnect(false)
    return data as T
  } catch (e) {
    if ((e as ApiError).status != null || (e as ApiError).code) {
      const err = e as ApiError
      noteReconnect(isTransientError(err))
      throw err
    }
    const err = makeError(undefined, 0, e)
    noteReconnect(true)
    throw err
  }
}

export function emptyMode(): boolean {
  if (typeof window === "undefined") return false
  const hash = window.location.hash || ""
  const search = window.location.search || ""
  return search.includes("empty=1") || hash.includes("empty=1") || hash.startsWith("#/empty")
}

export function retryNow() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(RETRY_EVENT))
}

export const api = {
  overview: () => request<Overview>("/api/overview"),
  apps: () => request<AppSummary[]>("/api/apps"),
  app: (service: string) => request<AppDetail>(`/api/app/${encodeURIComponent(service)}`),
  recap: (week: number) => request<Recap>(`/api/recap?week=${week}`),
  status: () => request<Status>("/api/status"),
  sources: () => request<{ now: number; sources: Source[] }>("/api/sources"),
  sessions: () => (emptyMode() ? Promise.resolve([] as Session[]) : request<Session[]>("/api/sessions")),
  session: (id: string) => request<SessionDetail>(`/api/session/${id}`),
  trace: (id: string) => request<Trace>(`/api/trace/${id}`),
  findings: () => request<Finding[]>("/api/findings"),
  fields: () => request<Field[]>("/api/fields"),
  cost: (dim: string) => request<CostTable>(`/api/cost?dim=${encodeURIComponent(dim)}`),
  range: () => request<Range>("/api/range"),
  query: (q: QuerySpec) =>
    request<QueryResult>("/api/query", { method: "POST", body: JSON.stringify(q) }),
  traces: (q: QuerySpec, group_values?: (string | null)[], bucket?: [number, number]) =>
    request<TraceHit[]>("/api/query/traces", {
      method: "POST",
      body: JSON.stringify({ query: q, group_values, bucket }),
    }),
  sql: (sql: string) => request<SqlResult>("/api/sql", { method: "POST", body: JSON.stringify({ sql }) }),
  askSuggestions: () => request<AskSuggestions>("/api/ask/suggestions"),
  ask: (question: string) =>
    request<AskResult>("/api/ask", { method: "POST", body: JSON.stringify({ question }) }),
  fieldValues: (field: string) => request<string[]>(`/api/field-values?field=${encodeURIComponent(field)}`),
}
