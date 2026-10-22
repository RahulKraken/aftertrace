import { spanKind, type SpanNode } from "./span"
import { STEP } from "./steps"

// Bulk folding for the waterfall, the way Honeycomb does it: everything at one
// depth, or every span of one kind, opens or closes together.

export function depthMap(root: SpanNode): Map<string, number> {
  const out = new Map<string, number>()
  const walk = (s: SpanNode, d: number) => {
    out.set(s.span_id, d)
    s.kids.forEach((k) => walk(k, d + 1))
  }
  walk(root, 0)
  return out
}

// Spans of one kind: the same span name, and for tools the same tool.
export function kindKey(s: SpanNode): string {
  return `${s.name}|${s.attrs.tool_name ?? ""}`
}

// What one of those spans is called in a sentence: "Bash calls", "model calls".
export function kindNoun(s: SpanNode): string {
  if (s.name === STEP) return "steps"
  const k = spanKind(s)
  const tool = String(s.attrs.tool_name || "")
  if (k === "model") return "model calls"
  if (k === "agent") return "subagents"
  if (k === "wait") return "waits on you"
  if (k === "run") return "tool runs"
  if (k === "hook") return "hooks"
  if (k === "tool" && tool) return `${tool} calls`
  return `“${s.name}” spans`
}

export function parentsWhere(root: SpanNode, pick: (s: SpanNode) => boolean): string[] {
  const out: string[] = []
  const walk = (s: SpanNode) => {
    if (s.kids.length && pick(s)) out.push(s.span_id)
    s.kids.forEach(walk)
  }
  walk(root)
  return out
}
