import { spanKind, toolFamily } from "./span"
import type { Span } from "./types"

export function hueVar(span: Span): string {
  const k = spanKind(span)
  if (k === "turn") return "var(--hue-turn)"
  if (k === "wait") return "var(--hue-wait)"
  if (k === "model") return "var(--hue-model)"
  if (k === "hook") return "var(--hue-hook)"
  if (k === "agent") return "var(--hue-agent)"
  if (k === "tool" || k === "run") {
    const f = toolFamily(String(span.attrs.tool_name || ""))
    if (f === "bash") return "var(--hue-bash)"
    if (f === "read" || f === "edit" || f === "search") return "var(--hue-file)"
    if (f === "mcp") return "var(--hue-mcp)"
    if (f === "skill") return "var(--hue-skill)"
    if (f === "web") return "var(--hue-web)"
    if (f === "agent") return "var(--hue-agent)"
    return "var(--hue-tool)"
  }
  // Structure (a request handler, an app's agent) is neutral; the calls inside carry the colour.
  if (k === "span" || (k === "agent" && !span.name.startsWith("claude_code."))) return "var(--hue-turn)"
  return "var(--hue-tool)"
}
