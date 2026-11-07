"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const { localGenericFeedUrl } = require("../src/feedUrl")

test("empty is production GitHub Releases (no override)", () => {
  assert.equal(localGenericFeedUrl(""), null)
  assert.equal(localGenericFeedUrl(undefined), null)
})

test("env feed override is ignored without CI/test intent", () => {
  const prev = {
    AFTERTRACE_UPDATE_FEED_URL: process.env.AFTERTRACE_UPDATE_FEED_URL,
    AFTERTRACE_SMOKE_ALLOW: process.env.AFTERTRACE_SMOKE_ALLOW,
    GITHUB_ACTIONS: process.env.GITHUB_ACTIONS,
    RUNNER_TEMP: process.env.RUNNER_TEMP,
    GITHUB_WORKSPACE: process.env.GITHUB_WORKSPACE,
  }
  try {
    delete process.env.AFTERTRACE_SMOKE_ALLOW
    delete process.env.GITHUB_ACTIONS
    delete process.env.RUNNER_TEMP
    delete process.env.GITHUB_WORKSPACE
    process.env.AFTERTRACE_UPDATE_FEED_URL = "http://127.0.0.1:8765/"
    assert.equal(localGenericFeedUrl(), null)
    process.env.AFTERTRACE_SMOKE_ALLOW = "1"
    assert.equal(localGenericFeedUrl(), "http://127.0.0.1:8765/")
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
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
