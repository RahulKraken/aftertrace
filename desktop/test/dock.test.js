"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const { setDashboardVisible } = require("../src/dock")

test("opening the dashboard shows the Dock", () => {
  const calls = []
  const app = {
    setActivationPolicy: (p) => calls.push(`policy:${p}`),
    dock: { show: () => calls.push("show"), hide: () => calls.push("hide") },
  }
  const r = setDashboardVisible(true, { app, platform: "darwin" })
  assert.equal(r.policy, "regular")
  assert.deepEqual(calls, ["policy:regular", "show"])
})

test("closing the dashboard hides the Dock and keeps accessory policy", () => {
  const calls = []
  const app = {
    setActivationPolicy: (p) => calls.push(`policy:${p}`),
    dock: { show: () => calls.push("show"), hide: () => calls.push("hide") },
  }
  setDashboardVisible(true, { app, platform: "darwin" })
  const r = setDashboardVisible(false, { app, platform: "darwin" })
  assert.equal(r.policy, "accessory")
  assert.deepEqual(calls, ["policy:regular", "show", "policy:accessory", "hide"])
})

test("non-Mac is a no-op", () => {
  const app = { dock: { show: () => assert.fail("show"), hide: () => assert.fail("hide") } }
  const r = setDashboardVisible(true, { app, platform: "linux" })
  assert.equal(r.skipped, true)
})
