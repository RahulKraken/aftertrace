"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { EventEmitter } = require("node:events")

test("smoke is off unless AFTERTRACE_SMOKE=1", () => {
  const prev = process.env.AFTERTRACE_SMOKE
  try {
    delete process.env.AFTERTRACE_SMOKE
    const smoke = require("../src/smoke")
    assert.equal(smoke.enabled(), false)
    process.env.AFTERTRACE_SMOKE = "1"
    assert.equal(smoke.enabled(), true)
  } finally {
    if (prev === undefined) delete process.env.AFTERTRACE_SMOKE
    else process.env.AFTERTRACE_SMOKE = prev
  }
})

test("file-protocol cmd check/restart does not use Playwright", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aftertrace-smoke-"))
  const prevSmoke = process.env.AFTERTRACE_SMOKE
  const prevDir = process.env.AFTERTRACE_SMOKE_DIR
  process.env.AFTERTRACE_SMOKE = "1"
  process.env.AFTERTRACE_SMOKE_DIR = dir
  delete require.cache[require.resolve("../src/smoke")]
  const smoke = require("../src/smoke")
  const updater = {
    getState: () => ({ status: "ready", version: "0.5.5" }),
    subscribe: (fn) => {
      fn(updater.getState())
      return () => {}
    },
    check: async () => {
      updater.checked = true
      return updater.getState()
    },
  }
  const events = new EventEmitter()
  try {
    smoke.start({
      updater,
      getVersion: () => "0.5.4",
      getUserData: () => "/tmp/aftertrace-user",
      restartToUpdate: () => events.emit("restart"),
    })
    const status = JSON.parse(fs.readFileSync(path.join(dir, "status.json"), "utf8"))
    assert.equal(status.version, "0.5.4")
    assert.equal(status.update.status, "ready")
    assert.equal(status.pid, process.pid)
    fs.writeFileSync(path.join(dir, "cmd"), "check\n")
    await new Promise((r) => setTimeout(r, 400))
    assert.equal(updater.checked, true)
    let restarted = false
    events.on("restart", () => {
      restarted = true
    })
    fs.writeFileSync(path.join(dir, "cmd"), "restart\n")
    await new Promise((r) => setTimeout(r, 400))
    assert.equal(restarted, true)
  } finally {
    if (prevSmoke === undefined) delete process.env.AFTERTRACE_SMOKE
    else process.env.AFTERTRACE_SMOKE = prevSmoke
    if (prevDir === undefined) delete process.env.AFTERTRACE_SMOKE_DIR
    else process.env.AFTERTRACE_SMOKE_DIR = prevDir
    delete require.cache[require.resolve("../src/smoke")]
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
