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
  const { lines, items, today, fragments, forbidden, firstSessionId } = expectedLabels()
  assert.equal(firstSessionId, SESSION_A)
  assert.equal(items[0].label, "aftertrace · CLI")
  assert.equal(items[0].sublabel, "Thinking · 40k · $1.23")
  assert.equal(items[1].label, "aftertrace · VS Code")
  assert.equal(items[1].sublabel, "Editing checkout.ts · 8.0k · $0.40")
  assert.equal(items[2].label, "acme-payments-platform-service")
  assert.match(items[2].sublabel, /\$2\.50/)
  assert.match(items[3].sublabel || items[3].label, /Reading README\.md/)
  assert.doesNotMatch(JSON.stringify(items[3]), /\$0|0 tok|40¢/)
  assert.equal(today, "Today $4.13")
  assert.notEqual(lines[0], today)
  const blob = items.map((i) => `${i.label} ${i.sublabel || ""}`).concat(today).join("\n")
  for (const f of fragments) assert.ok(blob.includes(f), f)
  for (const bad of forbidden) {
    assert.equal(blob.includes(bad), false, bad)
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
  for (const f of expectedBumpFragments()) assert.match(f, /41k|\$1\.73|Today/)
})
