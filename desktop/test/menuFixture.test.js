"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const {
  buildFixture,
  bumpFixture,
  expectedLabels,
  expectedBumpFragments,
  expectedView,
  SESSION_A,
} = require("../src/menuFixture")
const { formatSessionLine } = require("../src/sessionMenu")

test("synthetic fixture is labelled and has no real-user fields", () => {
  const fx = buildFixture(1_700_000_000_000_000_000)
  const blob = JSON.stringify(fx)
  assert.match(blob, /aftertrace\.synthetic/)
  assert.doesNotMatch(blob, /Rahul|claude\/projects|user@/)
  assert.equal(fx.sessions.length, 4)
  assert.equal(fx.sessions.filter((s) => s.repo === "aftertrace").length, 2)
  assert.ok(fx.sessions.some((s) => s.repo === "acme-payments-platform-service"))
  assert.ok(fx.sessions.some((s) => s.cost_usd == null))
})

test("expected top-level lines carry identity, doing, tokens and session dollars", () => {
  const { lines, today, fragments, forbidden, firstSessionId } = expectedLabels()
  assert.equal(firstSessionId, SESSION_A)
  assert.match(lines[0], /aftertrace · Claude Code/)
  assert.match(lines[0], /Thinking · Opus 5\.5/)
  assert.match(lines[0], /40k tok/)
  assert.match(lines[0], /\$1\.23/)
  assert.match(lines[1], /aftertrace · VS Code/)
  assert.match(lines[1], /8\.0k tok/)
  assert.match(lines[2], /acme-payments-platform-service/)
  assert.match(lines[2], /\$2\.50/)
  assert.match(lines[3], /Reading README\.md/)
  assert.doesNotMatch(lines[3], /\$0|0 tok/)
  assert.equal(today, "Today · $4.13")
  assert.notEqual(lines[0], today)
  for (const f of fragments) assert.ok(lines.concat(today).join("\n").includes(f) || today.includes(f) || lines.some((l) => l.includes(f)))
  for (const bad of forbidden) {
    assert.equal(
      lines.concat(today).some((l) => l.includes(bad)),
      false,
      bad,
    )
  }
})

test("unknown session is omitted amounts, never zero", () => {
  const view = expectedView()
  const unknown = view.sessions[3]
  const line = formatSessionLine(unknown, view.sessions)
  assert.equal(unknown.tokens, undefined)
  assert.equal(unknown.cost_usd, undefined)
  assert.doesNotMatch(line, /\$0|0 tok|0¢/)
})

test("bump stays on the same live session id", () => {
  const bump = bumpFixture()
  const span = bump.traces.resourceSpans[0].scopeSpans[0].spans[0]
  const live = buildFixture().traces.resourceSpans[0].scopeSpans[0].spans.find((s) => s.name === "claude_code.llm_request")
  assert.equal(span.traceId, live.traceId)
  for (const f of expectedBumpFragments()) assert.match(f, /41k tok|\$1\.73|Today/)
})
