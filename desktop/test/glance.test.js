"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const http = require("http")
const { formatGlance, readGlance, sayUsd } = require("../src/glance")

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
    assert.deepEqual(g, { ok: true, findings: 4, weekCost: 1.25 })
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
