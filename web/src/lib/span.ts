import type { Span, SpanKind, ToolFamily, Trace } from "./types"

export type SpanNode = Span & { kids: SpanNode[] }

export function spanKind(s: Span): SpanKind {
  if (s.name === "claude_code.interaction") return "turn"
  if (s.name === "claude_code.llm_request") return "model"
  if (s.name === "claude_code.tool.blocked_on_user") return "wait"
  if (s.name === "claude_code.tool.execution") return "run"
  if (s.name === "claude_code.hook") return "hook"
  if (s.name === "claude_code.tool" && s.attrs.tool_name === "Agent") return "agent"
  if (s.name === "claude_code.tool") return "tool"
  // Apps and agents on OpenTelemetry GenAI conventions.
  if (s.joined?.app_call) return "model"
  const op = String(s.attrs["gen_ai.operation.name"] || "")
  if (op === "execute_tool" || s.name.startsWith("execute_tool ") || /^anthropic\.(custom_|mcp_)?tool_use/.test(s.name) || s.name === "ai.toolCall")
    return "tool"
  if (op === "invoke_agent" || op === "create_agent" || s.name.startsWith("invoke_agent ")) return "agent"
  return "span"
}

export function isAppTrace(service: string | null | undefined): boolean {
  return Boolean(service) && !String(service).startsWith("claude-code")
}

// Token usage and timing for a model span, whatever convention sent it.
export function usageOf(s: Span): { input: number | null; output: number | null; cacheRead: number | null; cacheWrite: number | null; ttftMs: number | null; model: string } {
  const a = s.attrs
  const num = (...keys: string[]): number | null => {
    for (const k of keys) {
      const v = a[k]
      if (v != null && v !== "" && !Number.isNaN(Number(v))) return Number(v)
    }
    return null
  }
  const ttftS = num("gen_ai.response.time_to_first_chunk")
  return {
    input: num("input_tokens", "gen_ai.usage.input_tokens", "gen_ai.usage.prompt_tokens", "llm.token_count.prompt", "ai.usage.inputTokens", "ai.usage.promptTokens"),
    output: num("output_tokens", "gen_ai.usage.output_tokens", "gen_ai.usage.completion_tokens", "llm.token_count.completion", "ai.usage.outputTokens", "ai.usage.completionTokens"),
    cacheRead: num("cache_read_tokens", "gen_ai.usage.cache_read.input_tokens", "gen_ai.usage.cache_read_input_tokens", "llm.token_count.prompt_details.cache_read", "ai.usage.cachedInputTokens"),
    cacheWrite: num("cache_creation_tokens", "gen_ai.usage.cache_write.input_tokens", "gen_ai.usage.cache_creation.input_tokens", "gen_ai.usage.cache_creation_input_tokens"),
    ttftMs: num("ttft_ms", "ai.response.msToFirstChunk") ?? (ttftS != null ? ttftS * 1000 : null),
    model: String(a.model || s.joined?.model || a["gen_ai.response.model"] || a["gen_ai.request.model"] || a["ai.model.id"] || ""),
  }
}

export function toolFamily(name: string | undefined | null): ToolFamily {
  const t = name || ""
  if (t === "Agent") return "agent"
  if (t === "Bash") return "bash"
  if (t === "Read") return "read"
  if (t === "Edit" || t === "Write") return "edit"
  if (t === "Grep" || t === "Glob") return "search"
  if (t === "WebFetch" || t === "WebSearch") return "web"
  if (t === "Skill") return "skill"
  if (t.startsWith("mcp__")) return "mcp"
  return "other"
}

export function familyOf(s: Span): ToolFamily | SpanKind {
  const k = spanKind(s)
  if (k === "agent" && !s.name.startsWith("claude_code.")) return "agent"
  if (k === "tool" || k === "agent") return toolFamily(String(s.attrs.tool_name || ""))
  return k
}

export function labelOf(s: Span): { name: string; target: string } {
  const a = s.attrs
  const k = spanKind(s)
  if (k === "turn") {
    return {
      name: `Turn ${a["interaction.sequence"] ?? ""}`,
      target: `${a.user_prompt_length ?? 0} chars`,
    }
  }
  if (k === "model" && !s.name.startsWith("claude_code.")) {
    const u = usageOf(s)
    const reason = a["gen_ai.response.finish_reasons"] || a["anthropic.message.stop_reason"] || a["ai.response.finishReason"]
    return {
      name: u.model.replace(/^claude-/, "") || "model call",
      target: [s.joined?.provider || a["gen_ai.provider.name"] || a["gen_ai.system"], Array.isArray(reason) ? reason.join(",") : reason].filter(Boolean).join(" · "),
    }
  }
  if (k === "tool" && !s.name.startsWith("claude_code.")) {
    const t = String(a["gen_ai.tool.name"] || s.name.replace(/^(execute_tool|anthropic\.\w*tool_use)\s*/, ""))
    return { name: t || "tool", target: "" }
  }
  if (k === "agent" && !s.name.startsWith("claude_code.")) {
    return { name: String(a["gen_ai.agent.name"] || s.name.replace(/^invoke_agent\s*/, "")), target: "agent" }
  }
  if (k === "model") {
    const m = String(a.model || "").replace(/^claude-/, "")
    const who = a.agent_id
      ? String(a.query_source_safe || "subagent")
      : s.joined?.query_source === "compact"
        ? "compaction"
        : ""
    return {
      name: m || "model",
      target: [a.effort, who, a.stop_reason].filter(Boolean).join(" · "),
    }
  }
  if (k === "tool" || k === "agent") {
    const t = String(a.tool_name || "")
    if (t.startsWith("mcp__")) {
      const parts = t.split("__")
      const server = String(s.joined?.["mcp_server.name"] || parts[1] || "")
      const tool = parts.slice(2).join("__")
      return { name: tool || t, target: server }
    }
    const target = String(a.full_command || a.file_path || a.skill_name || a.subagent_type || "")
    return { name: t || "tool", target }
  }
  if (k === "wait") {
    return {
      name: "waiting on you",
      target: [a.decision, a.source].filter(Boolean).join(" · "),
    }
  }
  if (k === "run") {
    return {
      name: "run",
      target: a.success === false ? String(a.error_class || "error") : "",
    }
  }
  if (k === "hook") return { name: String(a.hook_name || "hook"), target: String(a.hook_event || "") }
  return { name: s.name, target: "" }
}

export function buildForest(spans: Span[]): { root: SpanNode; byId: Map<string, SpanNode> } {
  const byId = new Map<string, SpanNode>()
  for (const s of spans) byId.set(s.span_id, { ...s, kids: [] })
  let root: SpanNode | null = null
  for (const node of byId.values()) {
    const parent = node.parent_span_id ? byId.get(node.parent_span_id) : undefined
    if (parent) parent.kids.push(node)
    else if (!root || node.name === "claude_code.interaction") root = node
  }
  if (!root) throw new Error("trace has no root span")
  for (const node of byId.values()) {
    node.kids.sort((a, b) => a.start_ns - b.start_ns || b.end_ns - a.end_ns)
  }
  return { root, byId }
}

export function defaultCollapsed(root: SpanNode): Set<string> {
  const out = new Set<string>()
  const walk = (s: SpanNode) => {
    const k = spanKind(s)
    if (k === "tool" && s.kids.length) out.add(s.span_id)
    if (k === "agent" && s.kids.length) out.add(s.span_id)
    s.kids.forEach(walk)
  }
  walk(root)
  return out
}

export function rollup(s: SpanNode): { n: number; cost: number } {
  let n = 0
  let cost = 0
  const walk = (x: SpanNode) => {
    for (const k of x.kids) {
      n++
      cost += k.joined?.cost_usd || 0
      walk(k)
    }
  }
  walk(s)
  return { n, cost }
}

export function visibleRows(
  root: SpanNode,
  collapsed: Set<string>,
  nowNs = Number.POSITIVE_INFINITY,
): { span: SpanNode; depth: number }[] {
  const out: { span: SpanNode; depth: number }[] = []
  const walk = (s: SpanNode, depth: number) => {
    if (s.start_ns > nowNs) return
    out.push({ span: s, depth })
    if (!collapsed.has(s.span_id)) s.kids.forEach((k) => walk(k, depth + 1))
  }
  walk(root, 0)
  return out
}

export function costOf(s: SpanNode): number {
  const k = spanKind(s)
  if (k === "turn" || k === "agent" || (k === "span" && s.kids.length)) return rollup(s).cost
  return s.joined?.cost_usd || 0
}

export function costUntil(root: SpanNode, nowNs: number): number {
  let cost = 0
  const walk = (s: SpanNode) => {
    if (s.end_ns <= nowNs) cost += s.joined?.cost_usd || 0
    s.kids.forEach(walk)
  }
  walk(root)
  return cost
}

export function callCount(spans: Span[], nowNs = Number.POSITIVE_INFINITY): number {
  let n = 0
  for (const s of spans) {
    if (s.start_ns > nowNs) continue
    if (s.name === "claude_code.llm_request" || s.name === "claude_code.tool") n++
  }
  return n
}

export function errorCount(spans: Span[], nowNs = Number.POSITIVE_INFINITY): number {
  let n = 0
  for (const s of spans) {
    if (s.start_ns > nowNs) continue
    if (s.is_error) n++
  }
  return n
}

export function kindLabel(s: Span): string {
  const k = spanKind(s)
  if (k === "turn") return "Turn"
  if (k === "model") return "LLM call"
  if (k === "wait") return "Permission wait"
  if (k === "agent") return "Subagent"
  if (k === "tool") return "Tool"
  if (k === "run") return "Run"
  if (k === "hook") return "Hook"
  return "Span"
}

export function hasError(s: SpanNode): boolean {
  if (s.is_error) return true
  return s.kids.some(hasError)
}

export function ancestors(byId: Map<string, SpanNode>, id: string): string[] {
  const out: string[] = []
  let cur = byId.get(id)
  while (cur?.parent_span_id) {
    out.push(cur.parent_span_id)
    cur = byId.get(cur.parent_span_id)
  }
  return out
}

export function waitChild(s: SpanNode): SpanNode | undefined {
  return s.kids.find((k) => k.name === "claude_code.tool.blocked_on_user")
}

export function runChild(s: SpanNode): SpanNode | undefined {
  return s.kids.find((k) => k.name === "claude_code.tool.execution")
}

export function compactionEvents(t: Trace): Trace["events"] {
  return t.events.filter((e) => e.name === "compaction")
}
