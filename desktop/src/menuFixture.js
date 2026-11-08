"use strict"

// CI-only synthetic OTLP. aftertrace.synthetic=true. Not Rahul's sessions.
// Live turns omit claude_code.interaction so turn_roots.in_progress is true.
// A prior completed turn on the same session_id carries repo/entrypoint for
// the /api/sessions join (long-lived id, not overview.recent).

const { formatSessionLine, formatTodayLine } = require("./sessionMenu")

const SESSION_A = "11111111-1111-1111-1111-aaaaaaaaaaaa"
const SESSION_B = "22222222-2222-2222-2222-bbbbbbbbbbbb"
const SESSION_C = "33333333-3333-3333-3333-cccccccccccc"
const SESSION_D = "44444444-4444-4444-4444-dddddddddddd"

function kv(key, value) {
  if (typeof value === "boolean") return { key, value: { boolValue: value } }
  if (typeof value === "number" && Number.isFinite(value) && !Number.isInteger(value)) {
    return { key, value: { doubleValue: value } }
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return { key, value: { intValue: String(Math.trunc(value)) } }
  }
  return { key, value: { stringValue: String(value) } }
}

function attrs(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => kv(k, v))
}

function std(session) {
  return {
    "session.id": session.id,
    "app.version": "ci-menu-fixture",
    "app.entrypoint": session.entry || "",
    "vcs.repository.name": session.repo || "",
    "vcs.owner.name": "ci-fixture",
    "aftertrace.synthetic": "true",
  }
}

function resource() {
  return {
    attributes: attrs({
      "service.name": "claude-code",
      "service.version": "ci-menu-fixture",
      "aftertrace.synthetic": "true",
      "os.type": "darwin",
    }),
  }
}

function span({ traceId, spanId, parentSpanId, name, start, end, session, extra }) {
  return {
    traceId,
    spanId,
    parentSpanId: parentSpanId || undefined,
    name,
    kind: 1,
    startTimeUnixNano: String(start),
    endTimeUnixNano: String(end),
    attributes: attrs({ ...std(session), ...extra }),
  }
}

function logRecord({ traceId, spanId, ts, session, extra }) {
  return {
    timeUnixNano: String(ts),
    observedTimeUnixNano: String(ts + 2_000_000),
    body: { stringValue: "claude_code.api_request" },
    traceId,
    spanId,
    attributes: attrs({
      ...std(session),
      "event.name": "api_request",
      ...extra,
    }),
  }
}

function hex(ch, n) {
  return String(ch).repeat(n)
}

function sessionsSpec() {
  return [
    {
      id: SESSION_A,
      repo: "aftertrace",
      entry: "cli",
      model: "claude-opus-5-5",
      input: 20000,
      output: 20123,
      cost: 1.23,
      requestId: "req_fixture_a",
      liveTrace: hex("a", 32),
      liveParent: hex("a", 16),
      liveLlm: hex("1", 16),
      doneTrace: hex("b", 32),
      doneRoot: hex("b", 16),
      kind: "thinking",
    },
    {
      id: SESSION_B,
      repo: "aftertrace",
      entry: "claude-vscode",
      model: "claude-sonnet-5",
      input: 5000,
      output: 3000,
      cost: 0.4,
      requestId: "req_fixture_b",
      liveTrace: hex("c", 32),
      liveParent: hex("c", 16),
      liveLlm: hex("2", 16),
      liveTool: hex("3", 16),
      doneTrace: hex("d", 32),
      doneRoot: hex("d", 16),
      kind: "edit",
      file: "checkout.ts",
    },
    {
      id: SESSION_C,
      repo: "acme-payments-platform-service",
      entry: "cli",
      model: "claude-sonnet-5",
      input: 900,
      output: 600,
      cost: 2.5,
      requestId: "req_fixture_c",
      liveTrace: hex("e", 32),
      liveParent: hex("e", 16),
      liveLlm: hex("4", 16),
      liveTool: hex("5", 16),
      doneTrace: hex("f", 32),
      doneRoot: hex("f", 16),
      kind: "bash",
    },
    {
      id: SESSION_D,
      repo: "",
      entry: "",
      liveTrace: hex("9", 32),
      liveParent: hex("9", 16),
      liveTool: hex("8", 16),
      kind: "unknown",
      file: "README.md",
    },
  ]
}

function completedTurn(session, now, i) {
  const start = now - (180 - i * 5) * 1e9
  const end = start + 2e9
  return span({
    traceId: session.doneTrace,
    spanId: session.doneRoot,
    name: "claude_code.interaction",
    start,
    end,
    session,
    extra: {
      "interaction.sequence": 1,
      "user_prompt_length": 24,
    },
  })
}

function liveSpans(session, now, i) {
  const start = now - (40 - i * 3) * 1e9
  const mid = start + 1e9
  const end = now - (2 - i) * 1e8
  const out = []
  if (session.kind !== "unknown") {
    out.push(
      span({
        traceId: session.liveTrace,
        spanId: session.liveLlm,
        parentSpanId: session.liveParent,
        name: "claude_code.llm_request",
        start,
        end: session.kind === "thinking" ? end : mid,
        session,
        extra: {
          model: session.model,
          "gen_ai.request.model": session.model,
          request_id: session.requestId,
          input_tokens: session.input,
          output_tokens: session.output,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          success: true,
        },
      }),
    )
  }
  if (session.kind === "edit") {
    out.push(
      span({
        traceId: session.liveTrace,
        spanId: session.liveTool,
        parentSpanId: session.liveParent,
        name: "claude_code.tool",
        start: mid,
        end,
        session,
        extra: { tool_name: "Edit", file_path: `src/${session.file}` },
      }),
    )
  }
  if (session.kind === "bash") {
    out.push(
      span({
        traceId: session.liveTrace,
        spanId: session.liveTool,
        parentSpanId: session.liveParent,
        name: "claude_code.tool",
        start: mid,
        end,
        session,
        extra: { tool_name: "Bash", full_command: "npm test" },
      }),
    )
  }
  if (session.kind === "unknown") {
    out.push(
      span({
        traceId: session.liveTrace,
        spanId: session.liveTool,
        parentSpanId: session.liveParent,
        name: "claude_code.tool",
        start,
        end,
        session,
        extra: { tool_name: "Read", file_path: session.file },
      }),
    )
  }
  return out
}

function liveLogs(session, now) {
  if (!session.requestId) return []
  return [
    logRecord({
      traceId: session.liveTrace,
      spanId: session.liveLlm,
      ts: now - 1e8,
      session,
      extra: {
        request_id: session.requestId,
        cost_usd: session.cost,
        model: session.model,
      },
    }),
  ]
}

function buildFixture(now = Date.now() * 1e6) {
  const specs = sessionsSpec()
  const spans = []
  const logs = []
  specs.forEach((s, i) => {
    if (s.doneTrace) spans.push(completedTurn(s, now, i))
    spans.push(...liveSpans(s, now, i))
    logs.push(...liveLogs(s, now))
  })
  return {
    now,
    synthetic: true,
    sessions: specs.map((s) => ({
      session_id: s.id,
      repo: s.repo,
      entrypoint: s.entry,
      tokens: s.input != null ? s.input + s.output : undefined,
      cost_usd: s.cost,
      kind: s.kind,
    })),
    traces: { resourceSpans: [{ resource: resource(), scopeSpans: [{ spans }] }] },
    logs: { resourceLogs: [{ resource: resource(), scopeLogs: [{ logRecords: logs }] }] },
  }
}

function bumpFixture(now = Date.now() * 1e6) {
  const a = sessionsSpec()[0]
  const start = now - 5e8
  const end = now - 1e7
  const requestId = "req_fixture_a_bump"
  // Same live trace as session A so we do not add a fifth live lane.
  return {
    traces: {
      resourceSpans: [
        {
          resource: resource(),
          scopeSpans: [
            {
              spans: [
                span({
                  traceId: a.liveTrace,
                  spanId: hex("7", 16),
                  parentSpanId: a.liveParent,
                  name: "claude_code.llm_request",
                  start,
                  end,
                  session: a,
                  extra: {
                    model: a.model,
                    request_id: requestId,
                    input_tokens: 400,
                    output_tokens: 600,
                    cache_read_tokens: 0,
                    cache_creation_tokens: 0,
                    success: true,
                  },
                }),
              ],
            },
          ],
        },
      ],
    },
    logs: {
      resourceLogs: [
        {
          resource: resource(),
          scopeLogs: [
            {
              logRecords: [
                logRecord({
                  traceId: a.liveTrace,
                  spanId: hex("7", 16),
                  ts: end,
                  session: a,
                  extra: { request_id: requestId, cost_usd: 0.5, model: a.model },
                }),
              ],
            },
          ],
        },
      ],
    },
  }
}

function expectedView() {
  const shown = [
    {
      session_id: SESSION_A,
      repo: "aftertrace",
      entrypoint: "cli",
      doing: "Thinking · Opus 5.5",
      tokens: 40123,
      cost_usd: 1.23,
    },
    {
      session_id: SESSION_B,
      repo: "aftertrace",
      entrypoint: "claude-vscode",
      doing: "Editing checkout.ts",
      tokens: 8000,
      cost_usd: 0.4,
    },
    {
      session_id: SESSION_C,
      repo: "acme-payments-platform-service",
      entrypoint: "cli",
      doing: "Running npm test",
      tokens: 1500,
      cost_usd: 2.5,
    },
    {
      session_id: SESSION_D,
      repo: "",
      entrypoint: "",
      source: "claude-code",
      doing: "Reading README.md",
    },
  ]
  return {
    ok: true,
    sessions: shown,
    todayCost: 4.13,
    estimated: false,
  }
}

function expectedLabels() {
  const view = expectedView()
  return {
    lines: view.sessions.map((s) => formatSessionLine(s, view.sessions)),
    today: formatTodayLine(view),
    firstSessionId: SESSION_A,
    fragments: ["40k tok", "$1.23", "8.0k tok", "acme-payments-platform-service", "Today · $4.13"],
    forbidden: ["Engine offline", "$0", "0 tok", "permission"],
  }
}

function expectedBumpFragments() {
  return ["41k tok", "$1.73", "Today · $4.63"]
}

module.exports = {
  SESSION_A,
  SESSION_B,
  SESSION_C,
  SESSION_D,
  buildFixture,
  bumpFixture,
  expectedView,
  expectedLabels,
  expectedBumpFragments,
}
