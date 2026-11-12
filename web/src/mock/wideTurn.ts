import type { Span, Trace, TraceEvent } from "../lib/types"

// Fixture for the timeline layout hotfix: 100+ character names, nested
// agents, a turn longer than a minute, and millisecond spans next to long ones.
export const WIDE_TURN_ID = "wide-turn"

const SESSION = "e61c32c0-0193-4bab-9096-4e952c6c8a0c"
const T0 = Date.UTC(2026, 10, 12, 1, 11, 0) * 1e6
const EDGE_MS = 87_000

// Sonnet-ish: $3/M in, $15/M out. Last call is the long right-edge label.
const LLM_USAGE = [
  { input: 2_000, output: 400, cost: 0.012 },
  { input: 2_800, output: 500, cost: 0.016 },
  { input: 3_500, output: 630, cost: 0.02 },
  { input: 4_000, output: 800, cost: 0.024 },
  { input: 22_000, output: 92_600, cost: 1.45 },
]

const LONG_TITLES = [
  "No VMs, Cloud SQL, and a private service range: checking whether the Composer environment can reach the Airflow metadata DB through the VPC connector",
  "Reading the failing integration test output for checkout timeout ORD-142 and the charge path around the Stripe webhook retry window",
  "Asking a subagent to grep the billing package for every place we construct a PaymentIntent without an idempotency key",
  "Opening src/checkout/session.go, internal/billing/charge.go, and the webhook handler that records the ORD-142 double charge",
  "Patching the idempotency key on the charge path and the Cloud SQL proxy sidecar so Composer can talk to the metadata database",
]

export function wideTurn(): Trace {
  const spans: Span[] = []
  const events: TraceEvent[] = []
  let n = 0
  const sid = (p: string) => `wide-${p}-${++n}`

  const push = (s: Omit<Span, "is_error" | "status_message" | "critical" | "retry_end_ns" | "findings"> & Partial<Span>) => {
    spans.push({
      is_error: false,
      status_message: null,
      critical: false,
      retry_end_ns: null,
      findings: [],
      ...s,
    })
  }

  const rootId = "wide-root"
  push({
    span_id: rootId,
    parent_span_id: null,
    name: "claude_code.interaction",
    start_ns: T0,
    end_ns: T0,
    duration_ms: 0,
    attrs: {
      "session.id": SESSION,
      "span.type": "claude_code.interaction",
      user_prompt: "No VMs, Cloud SQL, Composer networking, and the ORD-142 double charge.",
      user_prompt_length: 72,
      "interaction.sequence": 1,
    },
  })

  let cursor = T0 + 12e6
  LONG_TITLES.forEach((title, i) => {
    const rid = `wide-req-${i}`
    const thinkStart = cursor
    const usage = LLM_USAGE[i]
    const thinkMs = i === 4 ? EDGE_MS : 8_000 + i * 1_100
    const thinkEnd = thinkStart + thinkMs * 1e6
    push({
      span_id: sid("llm"),
      parent_span_id: rootId,
      name: "claude_code.llm_request",
      start_ns: thinkStart,
      end_ns: thinkEnd,
      duration_ms: thinkMs,
      attrs: {
        request_id: rid,
        "gen_ai.request.model": "claude-sonnet-5",
        model: "claude-sonnet-5",
        input_tokens: usage.input,
        output_tokens: usage.output,
      },
      joined: { cost_usd: usage.cost },
    })
    events.push({
      name: "assistant_response",
      ts_ns: thinkStart + 1e6,
      request_id: rid,
      attrs: { response: title, request_id: rid },
    })
    cursor = thinkEnd

    if (i === 0) {
      const bashId = sid("bash")
      const bashStart = cursor
      const bashEnd = bashStart + 4_000 * 1e6
      push({
        span_id: bashId,
        parent_span_id: rootId,
        name: "claude_code.tool",
        start_ns: bashStart,
        end_ns: bashEnd,
        duration_ms: 4_000,
        attrs: {
          tool_name: "Bash",
          full_command:
            "gcloud composer environments describe prod --location=us-central1 --format='yaml(config.nodeConfig,config.privateEnvironmentConfig)'",
        },
        joined: { cost_usd: 0.004 },
      })
      push({
        span_id: sid("exec"),
        parent_span_id: bashId,
        name: "claude_code.tool.execution",
        start_ns: bashStart + 8e6,
        end_ns: bashEnd,
        duration_ms: 3_992,
        attrs: {},
      })
      cursor = bashEnd
    }

    if (i === 1) {
      const globStart = cursor
      const globEnd = globStart + 3e6
      push({
        span_id: sid("glob"),
        parent_span_id: rootId,
        name: "claude_code.tool",
        start_ns: globStart,
        end_ns: globEnd,
        duration_ms: 3,
        attrs: { tool_name: "Glob", file_path: "**/*sql*" },
      })
      const readStart = globEnd
      const readEnd = readStart + 9e6
      push({
        span_id: sid("read"),
        parent_span_id: rootId,
        name: "claude_code.tool",
        start_ns: readStart,
        end_ns: readEnd,
        duration_ms: 9,
        attrs: { tool_name: "Read", file_path: "internal/billing/charge.go" },
      })
      cursor = readEnd
    }

    if (i === 2) {
      const agentId = sid("agent")
      const nestStart = cursor
      const nestEnd = nestStart + 11_000 * 1e6
      push({
        span_id: agentId,
        parent_span_id: rootId,
        name: "claude_code.tool",
        start_ns: nestStart,
        end_ns: nestEnd,
        duration_ms: 11_000,
        attrs: { tool_name: "Agent", subagent_type: "Explore" },
      })
      const grepId = sid("grep")
      push({
        span_id: grepId,
        parent_span_id: agentId,
        name: "claude_code.tool",
        start_ns: nestStart + 40e6,
        end_ns: nestEnd - 80e6,
        duration_ms: 10_880,
        attrs: { tool_name: "Grep", full_command: "rg --type go PaymentIntent" },
      })
      push({
        span_id: sid("grep-run"),
        parent_span_id: grepId,
        name: "claude_code.tool.execution",
        start_ns: nestStart + 48e6,
        end_ns: nestEnd - 80e6,
        duration_ms: 10_872,
        attrs: {},
      })
      const innerBash = sid("inner-bash")
      push({
        span_id: innerBash,
        parent_span_id: agentId,
        name: "claude_code.tool",
        start_ns: nestStart + 200e6,
        end_ns: nestStart + 204e6,
        duration_ms: 4,
        attrs: { tool_name: "Bash", full_command: "rg -l Cloud.SQL" },
      })
      push({
        span_id: sid("inner-exec"),
        parent_span_id: innerBash,
        name: "claude_code.tool.execution",
        start_ns: nestStart + 201e6,
        end_ns: nestStart + 204e6,
        duration_ms: 3,
        attrs: {},
      })
      cursor = nestEnd
    }

    if (i === 3) {
      const editStart = cursor
      const editEnd = editStart + 2_200 * 1e6
      push({
        span_id: sid("edit"),
        parent_span_id: rootId,
        name: "claude_code.tool",
        start_ns: editStart,
        end_ns: editEnd,
        duration_ms: 2_200,
        attrs: { tool_name: "Edit", file_path: "internal/billing/charge.go" },
      })
      cursor = editEnd
    }

    if (i === 4) {
      const globStart = Math.max(thinkStart + 1e6, thinkEnd - 12e6)
      push({
        span_id: sid("endglob"),
        parent_span_id: rootId,
        name: "claude_code.tool",
        start_ns: globStart,
        end_ns: globStart + 5e6,
        duration_ms: 5,
        attrs: { tool_name: "Glob", file_path: "**/*composer*" },
      })
    }
  })

  const end = Math.max(...spans.map((s) => s.end_ns))
  spans[0].end_ns = end
  spans[0].duration_ms = (end - T0) / 1e6

  return {
    trace_id: WIDE_TURN_ID,
    session_id: SESSION,
    spans,
    span_events: [],
    events,
    breakdown: { model: 52_000, tool: 17_200, permission_wait: 0, retry: 0, hook: 0, other: 13_800 },
    prev: null,
    next: null,
    turn_index: 1,
    turn_count: 293,
    service: "claude-code",
  }
}
