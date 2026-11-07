"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const http = require("http")
const { formatGlance, formatTitle, readGlance, sayUsd, freshnessLabel, markStale, todayCostFromDays, pickFinding } = require("../src/glance")

test("sayUsd matches spoken copy", () => {
  assert.equal(sayUsd(0.41), "41¢")
  assert.equal(sayUsd(3.4), "$3.40")
})

test("formatGlance prefers spend, then findings, then Open", () => {
  assert.equal(formatGlance({ ok: false }), "Starting…")
  assert.equal(formatGlance({ ok: true, weekCost: 3.4, findings: 2 }), "$3.40 this week · 2 findings")
  assert.equal(formatGlance({ ok: true, findings: 1 }), "1 finding")
  assert.equal(formatGlance({ ok: true, weekCost: 0, findings: 0 }), "Open Aftertrace")
  assert.equal(formatGlance({ ok: true }), "Open Aftertrace")
})

test("readGlance uses /api/status and /api/overview", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json")
    if (req.url === "/api/status") res.end(JSON.stringify({ findings: 4 }))
    else if (req.url === "/api/overview") res.end(JSON.stringify({ week: { cost_usd: 1.25 } }))
    else {
      res.statusCode = 404
      res.end("{}")
    }
  })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  const { port } = server.address()
  try {
    const g = await readGlance(`http://127.0.0.1:${port}`)
    assert.equal(g.ok, true)
    assert.equal(g.findings, 4)
    assert.equal(g.weekCost, 1.25)
    assert.equal(formatGlance(g), "$1.25 this week · 4 findings")
  } finally {
    server.close()
  }
})

test("readGlance still works when overview is missing", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/api/status") {
      res.setHeader("content-type", "application/json")
      res.end(JSON.stringify({ findings: 7 }))
      return
    }
    res.statusCode = 404
    res.end("no")
  })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  const { port } = server.address()
  try {
    const g = await readGlance(`http://127.0.0.1:${port}`)
    assert.equal(g.ok, true)
    assert.equal(g.findings, 7)
    assert.equal(g.weekCost, undefined)
    assert.equal(formatGlance(g), "7 findings")
  } finally {
    server.close()
  }
})

test("formatTitle is the current activity, not spend", () => {
  assert.equal(formatTitle({ ok: true, sessions: [] }), "")
  assert.equal(
    formatTitle({ ok: true, sessions: [{ running: true, doing: "Reading orders.go", title: "fix the parser" }] }),
    "Reading orders.go",
  )
})

test("quiet is not treated as awaiting approval", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json")
    if (req.url === "/api/status") res.end(JSON.stringify({ findings: 0, running: 2 }))
    else if (req.url === "/api/overview") {
      res.end(JSON.stringify({
        week: { cost_usd: 1 },
        live: [
          { session_id: "a", title: "one", doing: "Running tests", quiet: true },
          { session_id: "b", title: "two", doing: "Editing main.go", quiet: false },
          { session_id: "c", title: "three", doing: "Reading", quiet: false },
          { session_id: "d", title: "four", doing: "Searching", quiet: false },
        ],
      }))
    } else {
      res.statusCode = 404
      res.end("{}")
    }
  })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  const { port } = server.address()
  try {
    const g = await readGlance(`http://127.0.0.1:${port}`)
    assert.equal(g.sessions.length, 4)
    assert.equal(g.sessions[0].quiet, true)
    assert.equal(g.sessions[0].doing, "Running tests")
    assert.doesNotMatch(JSON.stringify(g), /needs you|waiting on you|awaiting/i)
    assert.equal(formatTitle(g), "Running tests")
  } finally {
    server.close()
  }
})

test("stale glance is honest", () => {
  const g = markStale({ ok: true, fetchedAt: 0, sessions: [] }, 100_000)
  assert.equal(g.stale, true)
  assert.match(freshnessLabel(g, 100_000), /stale/i)
})

test("today spend prefers calendar today, not a 90-day last slot", () => {
  const now = Date.parse("2026-11-07T12:00:00Z")
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const todayNs = start.getTime() * 1e6
  const days = [
    { start_ns: todayNs - 86400e9, cost_usd: 9 },
    { start_ns: todayNs, cost_usd: 1.25 },
  ]
  assert.equal(todayCostFromDays(days, now), 1.25)
})

test("one finding prefers the action line", () => {
  const f = pickFinding({
    savings: { shown: [{ id: 4, headline: "rule title", action: "Allow npm test" }] },
  })
  assert.equal(f.text, "Allow npm test")
  assert.equal(f.id, "4")
})
