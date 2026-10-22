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

const mockOn = import.meta.env.VITE_USE_MOCK !== "0"
const base = import.meta.env.VITE_API_BASE || ""

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (mockOn) {
    const { handle } = await import("../mock/handler")
    return (await handle(base + path, init)) as T
  }
  const res = await fetch(base + path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  })
  const data = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data
}

export function emptyMode(): boolean {
  if (typeof window === "undefined") return false
  const hash = window.location.hash || ""
  const search = window.location.search || ""
  return search.includes("empty=1") || hash.includes("empty=1") || hash.startsWith("#/empty")
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
