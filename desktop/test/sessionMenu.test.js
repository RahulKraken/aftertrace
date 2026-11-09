"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const {
  identFor,
  activityFor,
  sessionCopy,
  formatSessionLine,
  formatTodayLine,
  sessionSlice,
  isWaiting,
  menuTemplate,
  menuLabels,
  sayCompactTok,
  sayMenuUsd,
  supportsSublabel,
  supportsHeader,
  setMenuVariant,
  getMenuVariant,
  MAX_LIVE,
} = require("../src/sessionMenu")

const mac = { sublabelSupported: true, headerSupported: true, variant: "identity" }

function labels(view, handlers = mac) {
  return menuTemplate(view, handlers)
    .filter((item) => item.type !== "separator")
    .map((item) => [item.label, item.sublabel].filter(Boolean).join(" · "))
}

test("alive engine never shows Engine offline", () => {
  assert.equal(labels({ ok: false, error: "offline", alive: false })[0], "Engine offline")
  assert.equal(labels({ ok: false, error: "offline", alive: true })[0], "Starting…")
  assert.equal(labels({ ok: false, error: "offline", alive: true, busy: true })[0], "Engine busy")
})

test("idle menu has no finding and keeps utilities", () => {
  const items = labels({ ok: true, sessions: [] })
  assert.deepEqual(items.slice(0, 1), ["Idle"])
  assert.ok(items.includes("Open Aftertrace"))
  assert.ok(items.includes("Start at login"))
  assert.ok(items.includes("Check for updates"))
  assert.ok(items.includes("Quit Aftertrace"))
  assert.equal(items.some((l) => /permission|finding/i.test(l)), false)
})

test("identity variant: label is repo, sublabel is activity and amounts", () => {
  const copy = sessionCopy(
    {
      session_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      repo: "aftertrace",
      doing: "Thinking · Opus 5.5",
      tokens: 40123,
      cost_usd: 1.23,
    },
    [],
    "identity",
    true,
  )
  assert.equal(copy.label, "aftertrace")
  assert.equal(copy.sublabel, "Thinking · 40k · $1.23")
  assert.doesNotMatch(copy.sublabel, /tok|Opus|Claude Code/)
  const items = menuTemplate(
    {
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
    },
    mac,
  )
  assert.equal(items[0].label, "aftertrace")
  assert.equal(items[0].sublabel, "Thinking · 40k · $1.23")
  assert.equal(items.find((i) => i.type === "header").label, "Today $10.37")
})

test("activity variant: label is doing, sublabel is identity and amounts", () => {
  const copy = sessionCopy(
    {
      repo: "aftertrace",
      doing: "Editing checkout.ts",
      tokens: 8000,
      cost_usd: 0.4,
    },
    [],
    "activity",
    true,
  )
  assert.equal(copy.label, "Editing checkout.ts")
  assert.equal(copy.sublabel, "aftertrace · 8.0k · $0.40")
})

test("sublabel fallback joins on one stock label", () => {
  const copy = sessionCopy(
    { repo: "aftertrace", doing: "Thinking · Opus 5.5", tokens: 40123, cost_usd: 1.23 },
    [],
    "identity",
    false,
  )
  assert.equal(copy.label, "aftertrace · Thinking · 40k · $1.23")
  assert.equal(copy.sublabel, undefined)
})

test("currency is always dollar; tok suffix is omitted", () => {
  assert.equal(sayMenuUsd(0.4), "$0.40")
  assert.equal(sayMenuUsd(1.23), "$1.23")
  assert.equal(sayCompactTok(40123), "40k")
  assert.equal(sayCompactTok(8000), "8.0k")
  assert.equal(sayCompactTok(1500), "1.5k")
  assert.doesNotMatch(sayCompactTok(8000), /tok/)
})

test("duplicate repos disambiguate with a short tool, not a repeated product name", () => {
  const shown = [
    { session_id: "11111111-1111-1111-1111-111111111111", repo: "aftertrace", entrypoint: "cli", doing: "Reading" },
    { session_id: "22222222-2222-2222-2222-222222222222", repo: "aftertrace", entrypoint: "claude-vscode", doing: "Editing" },
  ]
  assert.equal(identFor(shown[0], shown), "aftertrace · CLI")
  assert.equal(identFor(shown[1], shown), "aftertrace · VS Code")
})

test("activity drops trailing model words", () => {
  assert.equal(activityFor({ doing: "Thinking · Opus 5.5" }), "Thinking")
  assert.equal(activityFor({ doing: "Editing checkout.ts" }), "Editing checkout.ts")
})

test("multiple live sessions all appear", () => {
  const sessions = [
    { session_id: "1", repo: "alpha", doing: "Reading a.go", tokens: 1000, cost_usd: 0.2 },
    { session_id: "2", repo: "beta", doing: "Editing b.go", tokens: 2000, cost_usd: 0.4 },
    { session_id: "3", repo: "gamma", doing: "Running tests", tokens: 3000, cost_usd: 0.6 },
  ]
  const items = menuTemplate({ ok: true, sessions }, mac)
  assert.equal(items[0].label, "alpha")
  assert.equal(items[1].label, "beta")
  assert.equal(items[2].label, "gamma")
  assert.match(items[1].sublabel, /\$0\.40/)
})

test("unknown tokens and cost are omitted, never zero", () => {
  const copy = sessionCopy(
    { repo: "aftertrace", doing: "Thinking · Opus 5.5", tokens: null, cost_usd: undefined },
    [],
    "identity",
    true,
  )
  assert.equal(copy.label, "aftertrace")
  assert.equal(copy.sublabel, "Thinking")
  const zeroSession = { repo: "aftertrace", doing: "Thinking · Opus 5.5", tokens: 0, cost_usd: 0 }
  const zero = sessionCopy(zeroSession, [], "identity", true)
  assert.equal(zero.sublabel, "Thinking")
  assert.doesNotMatch(formatSessionLine(zeroSession), /\$0|0 tok/)
  assert.equal(sayCompactTok(undefined), "")
  assert.equal(sayCompactTok(0), "")
})

test("today is a quiet period total; estimated history-only is labelled", () => {
  assert.equal(formatTodayLine({ ok: true, todayCost: 10.37 }), "Today $10.37")
  assert.equal(formatTodayLine({ ok: true, todayCost: 10.37, estimated: true }), "Today $10.37 estimated")
  assert.equal(formatTodayLine({ ok: true, todayCost: 0 }), "")
  const items = menuTemplate(
    {
      ok: true,
      sessions: [{ repo: "aftertrace", doing: "Thinking · Opus 5.5", tokens: 12000, cost_usd: 1.5 }],
      todayCost: 10.37,
      estimated: true,
    },
    mac,
  )
  assert.match(items[0].sublabel, /\$1\.50/)
  assert.equal(items.find((i) => i.type === "header").label, "Today $10.37 estimated")
})

test("quiet is not waiting; approval-wait doing stays on the row", () => {
  const quiet = { repo: "aftertrace", doing: "Thinking · Opus 5.5", quiet: true, tokens: 2000, cost_usd: 0.5 }
  assert.equal(isWaiting(quiet), false)
  assert.doesNotMatch(formatSessionLine(quiet), /wait/i)
  const wait = { repo: "aftertrace", doing: "Waiting for your approval", tokens: 2000, cost_usd: 0.5 }
  assert.equal(isWaiting(wait), true)
  const items = menuTemplate({ ok: true, sessions: [quiet, wait] }, mac)
  assert.doesNotMatch(items[0].sublabel, /wait/i)
  assert.match(items[1].sublabel, /Waiting for your approval/)
})

test("overflow is explicit and does not drop the rest silently", () => {
  const sessions = []
  for (let i = 0; i < 8; i += 1) {
    sessions.push({ session_id: String(i), repo: `repo${i}`, doing: "Reading", tokens: 1000, cost_usd: 0.1 })
  }
  const sliced = sessionSlice(sessions)
  assert.equal(sliced.shown.length, MAX_LIVE)
  assert.equal(sliced.more, 3)
  const items = menuTemplate({ ok: true, sessions }, mac)
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
      ...mac,
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
  assert.ok(items.includes("Restart to update · v0.5.5"))
  assert.equal(items.includes("Check for updates"), false)
})

test("finding copy is not in the native menu", () => {
  const text = menuLabels(
    {
      ok: true,
      sessions: [{ repo: "aftertrace", doing: "Thinking · Opus 5.5", tokens: 1000, cost_usd: 0.4 }],
      todayCost: 10.37,
      topFinding: "7 permission prompts for AskUserQuestion, all approved",
    },
    mac,
  ).join("\n")
  assert.doesNotMatch(text, /permission prompts/)
  assert.doesNotMatch(text, /AskUserQuestion/)
})

test("Open Aftertrace keeps a real accelerator; session rows do not fake columns with accelerators", () => {
  const items = menuTemplate(
    { ok: true, sessions: [{ repo: "aftertrace", doing: "Thinking", tokens: 1000, cost_usd: 0.4 }] },
    mac,
  )
  assert.equal(items.find((i) => i.label === "Open Aftertrace").accelerator, "CommandOrControl+O")
  assert.equal(items[0].accelerator, undefined)
})

test("supportsSublabel is macOS 14.4+ only", () => {
  assert.equal(supportsSublabel("14.3.1", "darwin"), false)
  assert.equal(supportsSublabel("14.4", "darwin"), true)
  assert.equal(supportsSublabel("15.1", "darwin"), true)
  assert.equal(supportsSublabel("15.1", "linux"), false)
  assert.equal(supportsHeader("13.6", "darwin"), false)
  assert.equal(supportsHeader("14.0", "darwin"), true)
})

test("setMenuVariant is identity by default and accepts activity", () => {
  const prev = getMenuVariant()
  try {
    assert.equal(setMenuVariant("activity"), "activity")
    assert.equal(getMenuVariant(), "activity")
    assert.equal(setMenuVariant("nope"), "identity")
  } finally {
    setMenuVariant(prev)
  }
})
