"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const { localGenericFeedUrl } = require("../src/feedUrl")

test("empty is production GitHub Releases (no override)", () => {
  assert.equal(localGenericFeedUrl(""), null)
  assert.equal(localGenericFeedUrl(undefined), null)
})

test("only http(s) 127.0.0.1 with no userinfo", () => {
  assert.equal(localGenericFeedUrl("http://127.0.0.1:8765/"), "http://127.0.0.1:8765/")
  assert.equal(localGenericFeedUrl("http://127.0.0.1:8765"), "http://127.0.0.1:8765/")
  assert.equal(localGenericFeedUrl("https://127.0.0.1/"), "https://127.0.0.1/")
  assert.equal(localGenericFeedUrl("http://localhost:8765/"), null)
  assert.equal(localGenericFeedUrl("http://[::1]/"), null)
  assert.equal(localGenericFeedUrl("https://github.com/RahulKraken/aftertrace/releases"), null)
  assert.equal(localGenericFeedUrl("http://127.0.0.1/updates"), null)
  assert.equal(localGenericFeedUrl("http://user:pass@127.0.0.1/"), null)
  assert.equal(localGenericFeedUrl("file:///tmp"), null)
  assert.equal(localGenericFeedUrl("not a url"), null)
})
