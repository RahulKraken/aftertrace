import type { Trace } from "./types"
import { spanKind, type SpanNode } from "./span"

// Where Claude Code puts content, when OTEL_LOG_USER_PROMPTS,
// OTEL_LOG_ASSISTANT_RESPONSES and OTEL_LOG_TOOL_CONTENT are on and
// aftertrace serve runs with --store-content:
//   prompt        user_prompt event `prompt` (the span's user_prompt stays redacted)
//   model output  assistant_response event `response`, joined on request_id
//   tool input    tool_result event `tool_input`, joined on tool_use_id
//   tool output   tool.output span event `output` on the claude_code.tool span

export type Content = { text: string; json?: unknown }

export type ContentIndex = {
  prompt: Content | null
  finalResponse: Content | null
  responseByRequest: Map<string, Content>
  inputByToolUse: Map<string, Content>
  outputBySpan: Map<string, Content>
  any: boolean
}

const REDACTED = new Set(["<REDACTED>", "[REDACTED]"])

function text(v: unknown): Content | null {
  if (v == null) return null
  if (typeof v !== "string") return { text: JSON.stringify(v, null, 2), json: v }
  if (!v.trim() || REDACTED.has(v)) return null
  const t = v.trim()
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    try {
      const json = JSON.parse(t)
      return { text: JSON.stringify(json, null, 2), json }
    } catch {
      // Claude Code truncates long values, which leaves invalid JSON. Show it as text.
    }
  }
  return { text: v }
}

export function indexContent(trace: Trace): ContentIndex {
  const responseByRequest = new Map<string, Content>()
  const inputByToolUse = new Map<string, Content>()
  const outputBySpan = new Map<string, Content>()
  let prompt: Content | null = null
  let finalResponse: Content | null = null
  let lastResponseTs = -1

  for (const e of trace.events) {
    if (e.name === "user_prompt" && !prompt) {
      prompt = text(e.attrs.prompt) || text(e.attrs.prompt_text)
    } else if (e.name === "assistant_response") {
      const c = text(e.attrs.response)
      if (!c) continue
      const rid = e.request_id || (e.attrs.request_id as string | undefined)
      if (rid) responseByRequest.set(rid, c)
      if (e.ts_ns > lastResponseTs) {
        lastResponseTs = e.ts_ns
        finalResponse = c
      }
    } else if (e.name === "tool_result") {
      const c = text(e.attrs.tool_input)
      const id = e.tool_use_id || (e.attrs.tool_use_id as string | undefined)
      if (c && id) inputByToolUse.set(id, c)
    }
  }
  for (const se of trace.span_events) {
    if (se.name !== "tool.output") continue
    const c = text(se.attrs.output)
    if (c) outputBySpan.set(se.span_id, c)
  }
  if (!prompt) {
    const root = trace.spans.find((s) => s.name === "claude_code.interaction")
    prompt = root ? text(root.attrs.user_prompt) : null
  }
  const any = Boolean(prompt || finalResponse || responseByRequest.size || inputByToolUse.size || outputBySpan.size)
  return { prompt, finalResponse, responseByRequest, inputByToolUse, outputBySpan, any }
}

export type SpanContent = {
  input: Content | null
  output: Content | null
  inputLabel: string
  outputLabel: string
  // Content that Claude Code never exports for this kind of span, even with every flag on.
  inputNote?: string
}

export function contentFor(span: SpanNode, idx: ContentIndex): SpanContent {
  const k = spanKind(span)
  const a = span.attrs
  if (k === "turn") {
    return { input: idx.prompt, output: idx.finalResponse, inputLabel: "Prompt", outputLabel: "Final response" }
  }
  if (k === "model") {
    const rid = String(a.request_id || "")
    return {
      input: null,
      output: (rid && idx.responseByRequest.get(rid)) || null,
      inputLabel: "Request",
      outputLabel: "Response",
      inputNote: "The full request is only exported with OTEL_LOG_RAW_API_BODIES.",
    }
  }
  if (k === "tool" || k === "agent") {
    const id = String(a.tool_use_id || "")
    let out = idx.outputBySpan.get(span.span_id) || null
    if (!out) {
      for (const kid of span.kids) {
        out = idx.outputBySpan.get(kid.span_id) || null
        if (out) break
      }
    }
    return {
      input: (id && idx.inputByToolUse.get(id)) || null,
      output: out,
      inputLabel: "Input",
      outputLabel: "Output",
    }
  }
  return { input: null, output: null, inputLabel: "Input", outputLabel: "Output" }
}

export function snippet(c: Content | null, max = 220): string {
  if (!c) return ""
  const j = c.json as Record<string, unknown> | undefined
  // Tool inputs are JSON. The command, path or query is the useful part.
  if (j && typeof j === "object" && !Array.isArray(j)) {
    for (const key of ["command", "file_path", "pattern", "query", "url", "prompt", "description"]) {
      if (typeof j[key] === "string") return clip(j[key] as string, max)
    }
  }
  return clip(c.text, max)
}

// Wrapper tags clients add around pasted text, e.g. <pasted_content id="...">.
const MARKUP = /<\/?[A-Za-z_][\w-]*(\s[^<>]*)?>/g

function clip(s: string, max: number): string {
  const one = s.replace(MARKUP, " ").replace(/\s+/g, " ").trim()
  return one.length > max ? one.slice(0, max - 1) + "…" : one
}
