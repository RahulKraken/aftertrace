import type { Span, Trace, TraceEvent } from "../lib/types"

// Extra titled steps for the ?long=1 demo turn. Kept out of TurnStory so the
// page only collapses long traces; the mock supplies the 20+ step example.
const LONG_STEPS = [
  "Reading the failing test output",
  "Asking a subagent to grep the checkout path",
  "Opening src/checkout/session.go",
  "go test ./internal/billing failed",
  "Patching the idempotency key on the charge path",
  "Re-running the unit tests",
  "Reading CLAUDE.md for the billing notes",
  "Asking a subagent to find other charge sites",
  "Editing tests/checkout_test.go",
  "npm test -- --watch=false",
  "Git diff of the checkout package",
  "Fixing a nil pointer in the webhook handler",
  "Asking a subagent to scan the webhook logs",
  "Retrying the failed HTTP 529 request",
  "Writing a regression test for double charge",
  "Formatting the patched files",
  "Updating the billing README",
  "Running go test ./...",
  "Staging the checkout changes",
  "Summarising what changed",
]

export function padLongTrace(t: Trace): Trace {
  if (t.spans.some((s) => s.span_id.startsWith("long-"))) return t
  const root = t.spans.find((s) => s.name === "claude_code.interaction")
  if (!root) return t
  let t0 = Math.max(...t.spans.map((s) => s.end_ns))
  const spans: Span[] = [...t.spans]
  const events: TraceEvent[] = [...(t.events || [])]
  for (let i = 0; i < LONG_STEPS.length; i++) {
    const start = t0 + (8 + i) * 1e9
    const end = start + (11 + i * 2) * 1e9
    const rid = `long-req-${i}`
    spans.push({
      span_id: `long-llm-${i}`,
      parent_span_id: root.span_id,
      name: "claude_code.llm_request",
      start_ns: start,
      end_ns: end,
      duration_ms: (end - start) / 1e6,
      is_error: false,
      status_message: null,
      attrs: { request_id: rid, "gen_ai.request.model": "claude-sonnet-5" },
      joined: { cost_usd: 0.012 + i * 0.004 },
    })
    events.push({
      name: "assistant_response",
      ts_ns: start + 1e9,
      request_id: rid,
      attrs: { response: LONG_STEPS[i], request_id: rid },
    })
    if (i === 1 || i === 7 || i === 12) {
      const agentId = `long-agent-${i}`
      const nestId = `long-nest-${i}`
      spans.push({
        span_id: agentId,
        parent_span_id: root.span_id,
        name: "claude_code.tool",
        start_ns: start + 2e9,
        end_ns: end - 1e9,
        duration_ms: (end - 1e9 - start - 2e9) / 1e6,
        is_error: false,
        status_message: null,
        attrs: { tool_name: "Agent", subagent_type: "Explore" },
      })
      spans.push({
        span_id: nestId,
        parent_span_id: agentId,
        name: "claude_code.tool",
        start_ns: start + 3e9,
        end_ns: end - 2e9,
        duration_ms: (end - 2e9 - start - 3e9) / 1e6,
        is_error: false,
        status_message: null,
        attrs: { tool_name: "Bash", full_command: "rg --type go charge" },
      })
    } else if (i === 3) {
      const toolId = `long-bash-${i}`
      spans.push({
        span_id: toolId,
        parent_span_id: root.span_id,
        name: "claude_code.tool",
        start_ns: start + 2e9,
        end_ns: end,
        duration_ms: (end - start - 2e9) / 1e6,
        is_error: true,
        status_message: "exit 1",
        attrs: { tool_name: "Bash", full_command: "go test ./internal/billing" },
      })
      spans.push({
        span_id: `long-exec-${i}`,
        parent_span_id: toolId,
        name: "claude_code.tool.execution",
        start_ns: start + 2.2e9,
        end_ns: end,
        duration_ms: (end - start - 2.2e9) / 1e6,
        is_error: true,
        status_message: "exit 1",
        attrs: {},
      })
    }
    t0 = end
  }
  return { ...t, spans, events }
}
