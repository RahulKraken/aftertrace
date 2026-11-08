"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const {
  identFor,
  formatSessionLine,
  formatTodayLine,
  sessionSlice,
  isWaiting,
  menuTemplate,
  menuLabels,
  sayTok,
  MAX_LIVE,
} = require("../src/sessionMenu")

function labels(view, handlers) {
  return menuTemplate(view, handlers)
    .filter((item) => item.type !== "separator")
    .map((item) => item.label)
}

test("idle menu has no finding and keeps utilities", () => {
  const items = labels({ ok: true, sessions: [] })
  assert.deepEqual(items.slice(0, 1), ["Idle"])
  assert.ok(items.includes("Open Aftertrace"))
  assert.ok(items.includes("Start at login"))
  assert.ok(items.includes("Check for updates"))
  assert.ok(items.includes("Quit Aftertrace"))
  assert.equal(items.some((l) => /permission|finding/i.test(l)), false)
})

test("one live session puts identity, doing, tokens and session cost on the top-level line", () => {
  const line = formatSessionLine({
    session_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    repo: "aftertrace",
    doing: "Thinking · Opus 5.5",
    tokens: 40123,
    cost_usd: 1.23,
  })
  assert.match(line, /aftertrace/)
  assert.match(line, /Thinking · Opus 5\.5/)
  assert.match(line, /40k tok/)
  assert.match(line, /\$1\.23/)
  const items = labels({
    ok: true,
    sessions: [
      {
        session_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        repo: "aftertrace",
        doing: "Thinking · Opus 5.5",
        tokens: 40123,
        cost_usd: 1.23,
      },
    ],
    todayCost: 10.37,
  })
  assert.equal(items[0], line)
  assert.ok(items.includes("Today · $10.37"))
  assert.ok(items[0].includes("$1.23"))
  assert.ok(items.includes("Today · $10.37"))
  assert.notEqual(items[0], "Today · $10.37")
})

test("multiple live sessions all appear", () => {
  const sessions = [
    { session_id: "1", repo: "alpha", doing: "Reading a.go", tokens: 1000, cost_usd: 0.2 },
    { session_id: "2", repo: "beta", doing: "Editing b.go", tokens: 2000, cost_usd: 0.4 },
    { session_id: "3", repo: "gamma", doing: "Running tests", tokens: 3000, cost_usd: 0.6 },
  ]
  const items = labels({ ok: true, sessions })
  assert.match(items[0], /^alpha ·/)
  assert.match(items[1], /^beta ·/)
  assert.match(items[2], /^gamma ·/)
})

test("duplicate repos disambiguate with tool or session tail", () => {
  const shown = [
    { session_id: "11111111-1111-1111-1111-111111111111", repo: "aftertrace", entrypoint: "cli", doing: "Reading" },
    { session_id: "22222222-2222-2222-2222-222222222222", repo: "aftertrace", entrypoint: "claude-vscode", doing: "Editing" },
  ]
  assert.equal(identFor(shown[0], shown), "aftertrace · Claude Code")
  assert.equal(identFor(shown[1], shown), "aftertrace · VS Code")
})

test("unknown tokens and cost are omitted, never zero", () => {
  const line = formatSessionLine({
    repo: "aftertrace",
    doing: "Thinking · Opus 5.5",
    tokens: null,
    cost_usd: undefined,
  })
  assert.equal(line, "aftertrace · Thinking · Opus 5.5")
  assert.equal(formatSessionLine({ repo: "aftertrace", doing: "Thinking · Opus 5.5", tokens: 0, cost_usd: 0 }), "aftertrace · Thinking · Opus 5.5")
  assert.equal(sayTok(undefined), "")
  assert.equal(sayTok(0), "")
})

test("today is a period total and estimated history-only is labelled", () => {
  assert.equal(formatTodayLine({ ok: true, todayCost: 10.37 }), "Today · $10.37")
  assert.equal(formatTodayLine({ ok: true, todayCost: 10.37, estimated: true }), "Today · $10.37 · estimated")
  assert.equal(formatTodayLine({ ok: true, todayCost: 0 }), "")
  assert.equal(formatTodayLine({ ok: true, todayCost: undefined }), "")
  const items = labels({
    ok: true,
    sessions: [{ repo: "aftertrace", doing: "Thinking · Opus 5.5", tokens: 12000, cost_usd: 1.5 }],
    todayCost: 10.37,
    estimated: true,
  })
  assert.match(items[0], /\$1\.50/)
  assert.ok(items.includes("Today · $10.37 · estimated"))
  assert.notEqual(items[0], items.find((l) => l.startsWith("Today")))
})

test("quiet is not waiting; approval-wait doing stays on the line", () => {
  const quiet = { repo: "aftertrace", doing: "Thinking · Opus 5.5", quiet: true, tokens: 2000, cost_usd: 0.5 }
  assert.equal(isWaiting(quiet), false)
  assert.doesNotMatch(formatSessionLine(quiet), /wait/i)
  const wait = { repo: "aftertrace", doing: "Waiting for your approval", tokens: 2000, cost_usd: 0.5 }
  assert.equal(isWaiting(wait), true)
  assert.match(formatSessionLine(wait), /Waiting for your approval/)
  const items = labels({ ok: true, sessions: [quiet, wait] })
  assert.doesNotMatch(items[0], /wait/i)
  assert.match(items[1], /Waiting for your approval/)
})

test("overflow is explicit and does not drop the rest silently", () => {
  const sessions = []
  for (let i = 0; i < 8; i += 1) {
    sessions.push({ session_id: String(i), repo: `repo${i}`, doing: "Reading", tokens: 1000, cost_usd: 0.1 })
  }
  const sliced = sessionSlice(sessions)
  assert.equal(sliced.shown.length, MAX_LIVE)
  assert.equal(sliced.more, 3)
  const items = menuTemplate({ ok: true, sessions })
  const overflow = items.find((i) => i.label && i.label.includes("more in Aftertrace"))
  assert.equal(overflow.label, "3 more in Aftertrace…")
  assert.equal(items.filter((i) => /^repo\d/.test(i.label || "")).length, MAX_LIVE)
})

test("session row opens that session; overflow opens /sessions", () => {
  const opened = []
  const sessions = []
  for (let i = 0; i < 6; i += 1) {
    sessions.push({ session_id: `id-${i}`, repo: `repo${i}`, doing: "Reading", tokens: 10, cost_usd: 0.2 })
  }
  const items = menuTemplate(
    { ok: true, sessions },
    {
      onOpen: (hash) => opened.push(["open", hash]),
      onOpenSession: (id) => opened.push(["session", id]),
    },
  )
  items[0].click()
  assert.deepEqual(opened[0], ["session", "id-0"])
  const overflow = items.find((i) => i.label === "1 more in Aftertrace…")
  overflow.click()
  assert.deepEqual(opened[1], ["open", "/sessions"])
})

test("restart to update stays in the footer", () => {
  const items = labels({ ok: true, sessions: [], update: { status: "ready", version: "0.5.5" } })
  assert.ok(items.includes("Restart to update · 0.5.5"))
  assert.equal(items.includes("Check for updates"), false)
})

test("finding copy is not in the native menu", () => {
  const text = menuLabels({
    ok: true,
    sessions: [{ repo: "aftertrace", doing: "Thinking · Opus 5.5", tokens: 1000, cost_usd: 0.4 }],
    todayCost: 10.37,
    topFinding: "7 permission prompts for AskUserQuestion, all approved",
  }).join("\n")
  assert.doesNotMatch(text, /permission prompts/)
  assert.doesNotMatch(text, /AskUserQuestion/)
})
