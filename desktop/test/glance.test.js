"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const http = require("http")
const { formatGlance, formatTitle, readGlance, sayUsd, freshnessLabel, markStale, todayCostFromDays, pickFinding, joinLiveSessions } = require("../src/glance")

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

test("readGlance uses one cheap /api/glance after /api/health", async () => {
  const hits = []
  const server = http.createServer((req, res) => {
    hits.push(req.url)
    res.setHeader("content-type", "application/json")
    if (req.url === "/api/health") res.end(JSON.stringify({ ok: true }))
    else if (req.url === "/api/glance") res.end(JSON.stringify({ findings: 4, week_cost: 1.25 }))
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
    assert.equal(g.alive, true)
    assert.equal(g.findings, 4)
    assert.equal(g.weekCost, 1.25)
    assert.equal(formatGlance(g), "$1.25 this week · 4 findings")
    assert.equal(hits.includes("/api/overview"), false)
    assert.equal(hits.includes("/api/status"), false)
    assert.equal(hits.includes("/api/sessions"), false)
  } finally {
    server.close()
  }
})

test("readGlance stays ok when glance is missing but health is up", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/api/health") {
      res.setHeader("content-type", "application/json")
      res.end(JSON.stringify({ ok: true, ready: false }))
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
    assert.equal(g.alive, true)
    assert.equal(g.error, null)
  } finally {
    server.close()
  }
})

test("health down is Engine offline unless the sidecar process is alive", async () => {
  const g = await readGlance("http://127.0.0.1:9")
  assert.equal(g.ok, false)
  assert.equal(g.alive, false)
  assert.equal(g.error, null)
  const gone = await readGlance("http://127.0.0.1:9", { last: { ok: true, sessions: [] } })
  assert.equal(gone.error, "offline")
  const busy = await readGlance("http://127.0.0.1:9", { processAlive: true })
  assert.equal(busy.ok, true)
  assert.equal(busy.alive, true)
  assert.equal(busy.error, null)
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
    if (req.url === "/api/health") res.end(JSON.stringify({ ok: true }))
    else if (req.url === "/api/glance") {
      res.end(JSON.stringify({
        week_cost: 1,
        running: 2,
        sessions: [
          { session_id: "a", title: "one", doing: "Running tests", quiet: true, running: true },
          { session_id: "b", title: "two", doing: "Editing main.go", quiet: false, running: true },
          { session_id: "c", title: "three", doing: "Reading", quiet: false, running: true },
          { session_id: "d", title: "four", doing: "Searching", quiet: false, running: true },
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

test("joinLiveSessions uses /api/sessions for long-lived ids not in recent", () => {
  const live = joinLiveSessions(
    {
      live: [
        {
          session_id: "old-sid",
          doing: "Thinking · Opus 5.5",
          quiet: true,
          source: "claude-code",
          cost_usd: 2.5,
        },
      ],
      recent: [{ session_id: "new-sid", repo: "other", tokens: 9 }],
    },
    [{ session_id: "old-sid", repo: "aftertrace", entrypoint: "cli", tokens: 40123, cost_usd: 2.5 }],
  )
  assert.equal(live.length, 1)
  assert.equal(live[0].repo, "aftertrace")
  assert.equal(live[0].entrypoint, "cli")
  assert.equal(live[0].tokens, 40123)
  assert.equal(live[0].cost_usd, 2.5)
  assert.equal(live[0].quiet, true)
  assert.equal(live[0].doing, "Thinking · Opus 5.5")
})

test("readGlance joins /api/sessions and records history_only as estimated", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json")
    if (req.url === "/api/health") res.end(JSON.stringify({ ok: true }))
    else if (req.url === "/api/glance") {
      res.end(JSON.stringify({
        findings: 1,
        running: 1,
        week_cost: 3,
        estimated: true,
        sessions: [{
          session_id: "old-sid",
          doing: "Waiting for your approval",
          quiet: false,
          repo: "aftertrace",
          tokens: 8000,
          cost_usd: 1.2,
          entrypoint: "cli",
          running: true,
        }],
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
    assert.equal(g.ok, true)
    assert.equal(g.estimated, true)
    assert.equal(g.sessions.length, 1)
    assert.equal(g.sessions[0].repo, "aftertrace")
    assert.equal(g.sessions[0].tokens, 8000)
    assert.equal(g.sessions[0].cost_usd, 1.2)
    assert.equal(g.sessions[0].doing, "Waiting for your approval")
    assert.doesNotMatch(JSON.stringify(g.sessions), /needs you/i)
  } finally {
    server.close()
  }
})
