import type { ContentIndex } from "./content"
import { snippet } from "./content"
import { modelName } from "./format"
import { labelOf, spanKind, type SpanNode } from "./span"
import { cleanPrompt, describe, firstLine, STEP } from "./steps"

// Rows say what happened: "Read service.go", "Thinking", step titles in Claude's words.
export function rowLabel(span: SpanNode, content: ContentIndex): { name: string; target: string } {
  if (span.name === STEP) return { name: String(span.attrs.title || "").replace(/`/g, ""), target: "" }
  const k = spanKind(span)
  if (k === "turn") {
    const label = labelOf(span)
    // A turn reads better as what you asked than as "153 chars".
    return { name: label.name, target: content.prompt ? snippet({ text: cleanPrompt(content.prompt.text) }, 120) : label.target }
  }
  if (span.name === "claude_code.llm_request") {
    // A call is named by what Claude said on it, when content is on.
    const said = span.attrs["aftertrace.step_title"] ? undefined : content.responseByRequest.get(String(span.attrs.request_id || ""))
    const replying = span.attrs.stop_reason === "end_turn"
    const name = said ? firstLine(said.text).replace(/`/g, "") : replying ? "Replying" : "Thinking"
    return { name, target: modelName(String(span.attrs.model || "")) }
  }
  if (spanKind(span) === "model" && !span.name.startsWith("claude_code.")) {
    const a = span.attrs
    const raw = a["gen_ai.response.finish_reasons"] || a["anthropic.message.stop_reason"] || a["ai.response.finishReason"]
    const reason = String(Array.isArray(raw) ? raw[0] : raw || "")
    const said: Record<string, string> = { end_turn: "replied", stop: "replied", tool_use: "asked for a tool", "tool-calls": "asked for a tool", tool_calls: "asked for a tool", max_tokens: "hit max tokens", length: "hit max tokens" }
    const model = modelName(String(a["gen_ai.response.model"] || a["gen_ai.request.model"] || span.joined?.model || a["ai.model.id"] || ""))
    return { name: model || labelOf(span).name, target: span.is_error ? "failed" : said[reason] || reason.replace(/_/g, " ") }
  }
  if (span.name === "claude_code.tool") {
    const d = describe(span, content)
    if (!d.object) return { name: d.verb, target: d.detail }
    if (d.cat === "mcp") return { name: d.verb, target: d.object }
    return { name: `${d.verb} ${d.object}`, target: d.detail }
  }
  if (span.name === "claude_code.tool.blocked_on_user") return { name: "waiting on you", target: decisionWords(span) }
  if (span.name === "claude_code.tool.execution") return { name: "running", target: span.is_error ? String(span.attrs.error_class || "failed") : "" }
  return labelOf(span)
}

// Permission decisions as a person would say them.
function decisionWords(span: SpanNode): string {
  const d = String(span.attrs.decision || "")
  const src = String(span.attrs.source || "")
  if (d === "reject" || d === "deny") return src.startsWith("user") ? "you declined" : "declined by your settings"
  if (src === "user_temporary") return "you approved it once"
  if (src === "user_permanent") return "you approved it for good"
  if (src.startsWith("user")) return "you approved it"
  if (src === "config") return "allowed by your settings"
  if (src === "hook") return "a hook decided"
  if (src) return `decided by ${src.replace(/_/g, " ")}`
  return ""
}

