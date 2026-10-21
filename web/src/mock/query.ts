import { fields, qSpans, allTracesForHits, type FlatSpan } from "./load"
import type { QueryResult, QuerySpec, TraceHit } from "../lib/types"

const COLUMNS: Record<string, string> = {
  duration_ms: "duration_ms",
  name: "name",
  cost_usd: "cost_usd",
  "session.id": "session_id",
  trace_id: "trace_id",
  is_error: "is_error",
}
const ALIASES: Record<string, string> = { repo: "vcs.repository.name" }

const known = new Set(fields.map((f) => f.key))

function fieldValue(row: FlatSpan, key: string): unknown {
  const k = ALIASES[key] || key
  if (k in COLUMNS) {
    const col = COLUMNS[k] as keyof FlatSpan
    const v = row[col]
    if (k === "is_error") return String(v)
    return v
  }
  if (Object.prototype.hasOwnProperty.call(row.attrs, k)) return row.attrs[k]
  if (row.event_attrs && Object.prototype.hasOwnProperty.call(row.event_attrs, k)) return row.event_attrs[k]
  return undefined
}

function asNum(v: unknown): number | null {
  if (v == null || v === "") return null
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function matchWhere(row: FlatSpan, spec: QuerySpec): boolean {
  for (const w of spec.where || []) {
    const op = w.op || "="
    const v = fieldValue(row, w.field)
    if (op === "exists") {
      if (v == null || v === "") return false
      continue
    }
    if (op === "not exists") {
      if (v != null && v !== "") return false
      continue
    }
    if (op === "contains") {
      if (!String(v ?? "").toLowerCase().includes(String(w.value ?? "").toLowerCase())) return false
      continue
    }
    if (op === ">" || op === "<" || op === ">=" || op === "<=") {
      const a = asNum(v)
      const b = asNum(w.value)
      if (a == null || b == null) return false
      if (op === ">" && !(a > b)) return false
      if (op === "<" && !(a < b)) return false
      if (op === ">=" && !(a >= b)) return false
      if (op === "<=" && !(a <= b)) return false
      continue
    }
    const sv = String(v ?? "")
    const want = String(w.value ?? "")
    if (op === "=" && sv !== want) return false
    if (op === "!=" && sv === want) return false
  }
  if (spec.from_ns != null && row.start_ns < spec.from_ns) return false
  if (spec.to_ns != null && row.start_ns >= spec.to_ns) return false
  return true
}

function quantile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo)
}

function aggregate(rows: FlatSpan[], spec: QuerySpec): number | null {
  const op = (spec.agg || "COUNT").toUpperCase()
  if (op === "COUNT") return rows.length
  const nums = rows.map((r) => asNum(fieldValue(r, spec.field))).filter((n): n is number => n != null)
  if (!nums.length) return null
  if (op === "SUM") return nums.reduce((a, b) => a + b, 0)
  if (op === "AVG") return nums.reduce((a, b) => a + b, 0) / nums.length
  if (op === "MIN") return Math.min(...nums)
  if (op === "MAX") return Math.max(...nums)
  const sorted = [...nums].sort((a, b) => a - b)
  if (op === "P50") return quantile(sorted, 0.5)
  if (op === "P95") return quantile(sorted, 0.95)
  if (op === "P99") return quantile(sorted, 0.99)
  return null
}

function compileSql(spec: QuerySpec): { sql: string; params: unknown[] } {
  const op = (spec.agg || "COUNT").toUpperCase()
  const agg =
    op === "COUNT"
      ? "count(*)"
      : op.startsWith("P")
        ? `quantile_cont(${spec.field}, ${op === "P50" ? 0.5 : op === "P95" ? 0.95 : 0.99})`
        : `${op.toLowerCase()}(${spec.field})`
  const groups = (spec.group_by || []).slice(0, 2)
  const params: unknown[] = []
  const clauses: string[] = []
  for (const w of spec.where || []) {
    clauses.push(`${w.field} ${w.op} ${w.op.includes("exists") ? "" : "?"}`.trim())
    if (!w.op.includes("exists")) params.push(w.value)
  }
  if (spec.from_ns) {
    clauses.push("start_ns >= ?")
    params.push(spec.from_ns)
  }
  if (spec.to_ns) {
    clauses.push("start_ns < ?")
    params.push(spec.to_ns)
  }
  const where = clauses.join(" AND ") || "TRUE"
  const sel = [...groups.map((g, i) => `${g} AS g${i}`), `${agg} AS value`, "count(*) AS n"].join(", ")
  const gb = groups.length ? `GROUP BY ${groups.map((_, i) => `g${i}`).join(", ")}` : ""
  const order = spec.order === "asc" ? "value ASC" : "value DESC"
  const limit = Math.max(1, Math.min(spec.limit || 20, 500))
  const sql = `SELECT ${sel}\nFROM q_spans\nWHERE ${where}\n${gb}\nORDER BY ${order} NULLS LAST\nLIMIT ${limit}`
  return { sql, params }
}

export function runQuery(spec: QuerySpec): QueryResult {
  for (const w of spec.where || []) {
    const k = ALIASES[w.field] || w.field
    if (!(k in COLUMNS) && !known.has(w.field) && !known.has(k)) {
      return { sql: "", params: [], table: [], series: [], step_ns: 0, lo: null, hi: null, error: `unknown field ${w.field}` }
    }
  }
  const matched = qSpans.filter((r) => matchWhere(r, spec))
  const groups = (spec.group_by || []).slice(0, 2)
  const buckets = new Map<string, FlatSpan[]>()
  for (const row of matched) {
    const key = JSON.stringify(groups.map((g) => {
      const v = fieldValue(row, g)
      return v == null ? null : String(v)
    }))
    const list = buckets.get(key)
    if (list) list.push(row)
    else buckets.set(key, [row])
  }
  let table = [...buckets.entries()].map(([key, rows]) => ({
    groups: JSON.parse(key) as (string | null)[],
    value: aggregate(rows, spec),
    n: rows.length,
  }))
  table.sort((a, b) => {
    const av = a.value ?? -Infinity
    const bv = b.value ?? -Infinity
    return spec.order === "asc" ? av - bv : bv - av
  })
  const limit = Math.max(1, Math.min(spec.limit || 20, 500))
  table = table.slice(0, limit)

  const lo0 = matched.length ? Math.min(...matched.map((r) => r.start_ns)) : null
  const hi0 = matched.length ? Math.max(...matched.map((r) => r.start_ns)) : null
  const lo = spec.from_ns ?? lo0
  const hi = spec.to_ns ?? (hi0 != null ? hi0 + 1 : null)
  const series: QueryResult["series"] = []
  let step = 0
  if (lo != null && hi != null) {
    const span = hi - lo
    const DAY = 86_400_000_000_000
    const HOUR = 3_600_000_000_000
    step = span > 3 * DAY ? DAY : span > 12 * HOUR ? HOUR : Math.max(Math.floor(span / 40), 60_000_000_000)
    const top = groups.length ? table.slice(0, 5) : [{ groups: [] as (string | null)[] }]
    for (const t of top) {
      const pts = new Map<number, FlatSpan[]>()
      for (const row of matched) {
        if (groups.some((g, i) => String(fieldValue(row, g) ?? "") !== String(t.groups[i] ?? ""))) continue
        const b = lo + Math.floor((row.start_ns - lo) / step) * step
        const list = pts.get(b)
        if (list) list.push(row)
        else pts.set(b, [row])
      }
      series.push({
        groups: t.groups,
        points: [...pts.entries()].sort((a, b) => a[0] - b[0]).map(([b, rows]) => [b, aggregate(rows, spec)]),
      })
    }
  }
  const { sql, params } = compileSql(spec)
  return { sql, params, table, series, step_ns: step, lo, hi }
}

export function queryTraces(spec: QuerySpec, groupValues?: (string | null)[], bucket?: [number, number]): TraceHit[] {
  const groups = (spec.group_by || []).slice(0, 2)
  const filtered = qSpans.filter((r) => {
    if (!matchWhere(r, spec)) return false
    if (groupValues) {
      for (let i = 0; i < groups.length; i++) {
        const v = fieldValue(r, groups[i])
        const want = groupValues[i]
        if (String(v ?? "") !== String(want ?? "")) return false
      }
    }
    if (bucket) {
      if (r.start_ns < bucket[0] || r.start_ns >= bucket[1]) return false
    }
    return true
  })
  const byTrace = new Map<string, FlatSpan[]>()
  for (const r of filtered) {
    const list = byTrace.get(r.trace_id)
    if (list) list.push(r)
    else byTrace.set(r.trace_id, [r])
  }
  const meta = allTracesForHits()
  const hits: TraceHit[] = []
  for (const [tid, rows] of byTrace) {
    let max = rows[0]
    for (const r of rows) if (r.duration_ms > max.duration_ms) max = r
    const m = meta.get(tid)
    hits.push({
      trace_id: tid,
      span_id: max.span_id,
      matches: rows.length,
      max_ms: max.duration_ms,
      session_id: m?.session_id ?? null,
      start_ns: m?.start_ns ?? null,
      turn_ms: m?.duration_ms ?? null,
      repo: m?.repo ?? null,
    })
  }
  hits.sort((a, b) => b.max_ms - a.max_ms)
  return hits.slice(0, 50)
}

export function fieldValues(key: string, limit = 30): string[] {
  const set = new Set<string>()
  for (const row of qSpans) {
    const v = fieldValue(row, key)
    if (v == null || v === "") continue
    set.add(String(v))
    if (set.size >= 80) break
  }
  return [...set].sort().slice(0, limit)
}

export function opsForField(key: string): string[] {
  const f = fields.find((x) => x.key === key)
  if (f?.kind === "num") return ["=", "!=", ">", "<", ">=", "<="]
  return ["=", "!=", "contains", "exists", "not exists"]
}
