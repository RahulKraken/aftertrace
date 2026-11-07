"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const { placeNearTray, WIDTH, HEIGHT } = require("../src/popover")
const { sessionSlice, updateFooter, freshnessKind } = require("../renderer/popoverView.js")

test("places the popover under the menu extra, on-screen", () => {
  const b = placeNearTray({ x: 1200, y: 0, width: 22, height: 22 }, {
    display: { workArea: { x: 0, y: 0, width: 1440, height: 900 } },
  })
  assert.equal(b.width, WIDTH)
  assert.equal(b.height, HEIGHT)
  assert.ok(b.x >= 8)
  assert.ok(b.x + b.width <= 1440 - 8)
  assert.ok(b.y >= 22)
})

test("multiple live sessions stay compact", () => {
  const sessions = [
    { doing: "one" },
    { doing: "two" },
    { doing: "three" },
    { doing: "four" },
    { doing: "five" },
  ]
  const s = sessionSlice(sessions)
  assert.equal(s.shown.length, 3)
  assert.equal(s.more, 2)
  assert.equal(s.idle, false)
})

test("idle and stale are honest kinds", () => {
  assert.equal(freshnessKind({ ok: false, error: "offline" }), "offline")
  assert.equal(freshnessKind({ ok: true, stale: true }), "stale")
  assert.equal(freshnessKind({ ok: true, stale: false }), "live")
  assert.equal(sessionSlice([]).idle, true)
})

test("update footer does not force a restart", () => {
  assert.equal(updateFooter({ status: "downloading" }).restart, false)
  assert.equal(updateFooter({ status: "ready", version: "0.5.4" }).label, "Restart to update · 0.5.4")
  assert.equal(updateFooter({ status: "error" }).label, "Retry update")
})
