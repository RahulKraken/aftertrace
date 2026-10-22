export type Breakdown = {
  model: number
  tool: number
  permission_wait: number
  retry: number
  hook: number
  // Permission prompts decided by config, a hook or auto mode. Absent in older payloads.
  permission_check?: number
  other: number
}

export type Session = {
  session_id: string
  start_ns: number
  end_ns: number
  turns: number
  turn_ms: number
  repo: string | null
  entrypoint: string | null
  cost_usd: number | null
  tokens: number | null
  cache_hit: number | null
  models: string[]
  errors: number
  retried: number
  agents: string[]
  breakdown: Breakdown | null
  findings: number
  // First prompt of the session, when content is captured.
  title?: string | null
  running?: boolean
}

export type Turn = {
  trace_id: string
  span_id: string
  start_ns: number
  duration_ms: number
  seq: number
  cost_usd: number | null
  requests: number
  models: string[]
  tools: number
  breakdown: Breakdown | null
  prompt?: string | null
  // No claude_code.interaction span yet. running: spans arrived in the last 5 minutes.
  in_progress?: boolean
  running?: boolean
}

export type SessionDetail = {
  session: Session
  turns: Turn[]
}

export type SpanJoined = {
  cost_usd?: number | null
  // Set on model calls from apps (the calls view), not on Claude Code spans.
  app_call?: boolean
  model?: string | null
  provider?: string | null
  cost_estimated?: boolean
  "skill.name"?: string | null
  "agent.name"?: string | null
  "mcp_server.name"?: string | null
  query_source?: string | null
}

export type Span = {
  span_id: string
  parent_span_id: string | null
  name: string
  start_ns: number
  end_ns: number
  duration_ms: number
  is_error: boolean
  status_message?: string | null
  attrs: Record<string, unknown>
  critical?: boolean
  joined?: SpanJoined | null
  retry_end_ns?: number | null
  findings?: number[]
}

export type SpanEvent = {
  span_id: string
  name: string
  time_ns: number
  attrs: Record<string, unknown>
}

export type TraceEvent = {
  name: string
  ts_ns: number
  tool_use_id?: string | null
  request_id?: string | null
  attrs: Record<string, unknown>
}

export type Trace = {
  trace_id: string
  session_id: string
  spans: Span[]
  span_events: SpanEvent[]
  events: TraceEvent[]
  breakdown: Breakdown | null
  prev: string | null
  next: string | null
  turn_index: number
  turn_count: number
  in_progress?: boolean
  // service.name of the trace. Anything not claude-code* is an app.
  service?: string
}

export type Evidence = {
  trace_id: string
  span_id: string
  label: string
}

export type Finding = {
  id: number
  rule_id: string
  rule_title?: string
  pillar: string
  severity: "high" | "medium" | "low" | "error"
  headline: string
  impact_value: number
  impact_unit: string
  detail: string
  recommendation: string
  evidence: Evidence[]
  sessions: string[]
}

export type Field = { key: string; kind: "num" | "str" }

export type CostTable = {
  dim: string
  columns: string[]
  rows: unknown[][]
  note: string
}

export type QuerySpec = {
  agg: string
  field: string
  where: { field: string; op: string; value?: string }[]
  group_by: string[]
  order: "asc" | "desc"
  limit: number
  from_ns?: number
  to_ns?: number
}

export type QueryResult = {
  sql: string
  params: unknown[]
  table: { groups: (string | null)[]; value: number | null; n: number }[]
  series: { groups: (string | null)[]; points: [number, number | null][] }[]
  step_ns: number
  lo: number | null
  hi: number | null
  error?: string
}

export type TraceHit = {
  trace_id: string
  span_id: string
  matches: number
  max_ms: number
  session_id: string | null
  start_ns: number | null
  turn_ms: number | null
  repo: string | null
}

export type SqlResult = {
  columns: string[]
  rows: unknown[][]
  error?: string
}

export type AskResult = {
  answer: string
  sql: string | null
  result: SqlResult | null
  evidence: Record<string, unknown>[]
  builder?: QuerySpec | null
  enabled?: boolean
  model?: string
  steps?: { sql: string; rows: number; error?: string }[]
}

export type AskSuggestions = {
  agent: string
  questions: string[]
  schema: string
  // false when the server runs without --ask; absent in the mock build.
  enabled?: boolean
}

export type Range = { lo: number; hi: number }

export type SpanKind =
  | "turn"
  | "model"
  | "tool"
  | "wait"
  | "run"
  | "hook"
  | "agent"
  | "span"

export type ToolFamily =
  | "bash"
  | "read"
  | "edit"
  | "search"
  | "web"
  | "skill"
  | "mcp"
  | "agent"
  | "other"

export type WindowStats = {
  sessions: number
  turns: number
  turn_ms: number
  breakdown: Breakdown
  cost_usd: number
  requests: number
  tokens: number
  cache_hit: number | null
  lines_added: number
  lines_removed: number
  commits: number
  pull_requests: number
  active_s: number
  tool_calls: number
  approvals: number
  errors: number
}

export type DayPoint = {
  day: string
  start_ns: number
  cost_usd: number
  turn_ms: number
  wait_ms: number
  turns: number
}

export type LiveLane = {
  session_id: string
  trace_id: string
  title: string | null
  source: string
  start_ns: number
  last_ns: number
  spans: number
  cost_usd: number
  doing: string
  quiet: boolean
}

export type Source = {
  name: string
  kind: "claude-code" | "app"
  spans: number
  events: number
  metrics: number
  first_ns: number
  last_ns: number
  live: boolean
}

export type Overview = {
  now: number
  lo: number
  hi: number
  anchored: boolean
  week: WindowStats
  prev: WindowStats
  days: DayPoint[]
  live: LiveLane[]
  sources: Source[]
  top: Finding | null
  open: number
  recent: Session[]
  has_data: boolean
}

export type Status = {
  now: number
  info: { version: string; db_path: string; store_content: boolean; otlp_grpc: string; otlp_http: string; ui: string }
  ask: { enabled: boolean; model?: string }
  counts: { Spans: number; SpanEvents: number; Events: number; MetricPoints: number }
  running: number
  sessions: number
  findings: number
  apps: number
  sources: number
  last_ns: number
}

export type AppSummary = {
  service: string
  spans: number
  traces: number
  calls: number
  failed: number
  cost_usd: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  p50_ms: number | null
  p95_ms: number | null
  ttft_p50_ms: number | null
  models: string[]
  operations: number
  first_ns: number
  last_ns: number
  live: boolean
  daily_cost: number[]
  daily_calls: number[]
}

export type AppGroup = {
  key: string
  calls: number
  failed: number
  cost_usd: number | null
  p50_ms: number | null
  p95_ms: number | null
  ttft_p50_ms: number | null
  avg_input_tokens: number | null
  avg_output_tokens: number | null
  models: string[]
  cost_estimated: boolean
}

export type AppDetail = {
  app: AppSummary
  operations: AppGroup[]
  models: AppGroup[]
  recent: { trace_id: string; name: string; start_ns: number; duration_ms: number; error: boolean; calls: number; cost_usd: number | null; tokens: number | null; models: string | null }[]
  errors: { trace_id: string; span_id: string; name: string; start_ns: number; message: string; error_type: string }[]
}
