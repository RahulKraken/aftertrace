"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const { isAllowedUrl } = require("../src/allowlist")

test("allows the local engine UI", () => {
  assert.equal(isAllowedUrl("http://127.0.0.1:7311/"), true)
  assert.equal(isAllowedUrl("http://127.0.0.1:7311/#/findings"), true)
  assert.equal(isAllowedUrl("http://127.0.0.1:7311/api/status"), true)
  assert.equal(isAllowedUrl("ws://127.0.0.1:7311/socket"), true)
})

test("allows the first-launch and waiting pages", () => {
  assert.equal(isAllowedUrl("file:///tmp/desktop/renderer/first-launch.html"), true)
  assert.equal(isAllowedUrl("file:///tmp/desktop/renderer/waiting.html"), true)
  assert.equal(isAllowedUrl("file:///C:/app/renderer/first-launch.html"), true)
})

test("rejects everything else", () => {
  assert.equal(isAllowedUrl("http://localhost:7311/"), false)
  assert.equal(isAllowedUrl("http://127.0.0.1/"), false)
  assert.equal(isAllowedUrl("http://127.0.0.1:80/"), false)
  assert.equal(isAllowedUrl("http://127.0.0.1:7312/"), false)
  assert.equal(isAllowedUrl("https://127.0.0.1:7311/"), false)
  assert.equal(isAllowedUrl("https://example.com/"), false)
  assert.equal(isAllowedUrl("file:///tmp/desktop/src/main.js"), false)
  assert.equal(isAllowedUrl("file:///etc/passwd"), false)
  assert.equal(isAllowedUrl("not a url"), false)
})
