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
  return "span"
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
  if (k === "turn" || k === "agent") return rollup(s).cost
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
