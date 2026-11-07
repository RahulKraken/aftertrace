"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const { senderKind, allowSender, dashboardHash } = require("../src/ipc")

function eventFor(url) {
  return {
    senderFrame: { url },
    sender: { getURL: () => url },
  }
}

test("popover, first-launch, waiting, and dashboard UI are distinct senders", () => {
  assert.equal(senderKind(eventFor("file:///tmp/desktop/renderer/popover.html")), "popover")
  assert.equal(senderKind(eventFor("file:///C:/app/renderer/first-launch.html")), "first-launch")
  assert.equal(senderKind(eventFor("file:///tmp/desktop/renderer/waiting.html")), "waiting")
  assert.equal(senderKind(eventFor("http://127.0.0.1:7311/#/findings")), "ui")
  assert.equal(senderKind(eventFor("https://example.com/")), "unknown")
  assert.equal(senderKind(eventFor("file:///tmp/desktop/src/main.js")), "file")
})

test("quit/restart stay off the dashboard origin", () => {
  assert.throws(() => allowSender(eventFor("http://127.0.0.1:7311/"), ["popover"]), /ipc denied from ui/)
  assert.equal(allowSender(eventFor("file:///app/renderer/popover.html"), ["popover"]), "popover")
})

test("dashboardHash allows finding focus and rejects traversal", () => {
  assert.equal(dashboardHash("/findings?focus=4"), "/findings?focus=4")
  assert.equal(dashboardHash("#/settings"), "/settings")
  assert.equal(dashboardHash("javascript:alert(1)"), "")
  assert.equal(dashboardHash("/../../etc/passwd"), "")
  assert.equal(dashboardHash("https://evil.example/"), "")
})
