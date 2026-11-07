"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const { ciIntent } = require("../src/ciIntent")

test("ciIntent is explicit ALLOW or GitHub-hosted Actions", () => {
  assert.equal(ciIntent({}), false)
  assert.equal(ciIntent({ AFTERTRACE_SMOKE: "1" }), false)
  assert.equal(ciIntent({ GITHUB_ACTIONS: "true" }), false)
  assert.equal(ciIntent({ GITHUB_ACTIONS: "true", RUNNER_TEMP: "/tmp" }), true)
  assert.equal(ciIntent({ GITHUB_ACTIONS: "true", GITHUB_WORKSPACE: "/w" }), true)
  assert.equal(ciIntent({ AFTERTRACE_SMOKE_ALLOW: "1" }), true)
  assert.equal(ciIntent({ AFTERTRACE_SMOKE_ALLOW: "1", GITHUB_ACTIONS: "false" }), true)
})
