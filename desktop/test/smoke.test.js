"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { EventEmitter } = require("node:events")

function withEnv(overrides, fn) {
  const keys = Object.keys(overrides)
  const prev = {}
  for (const k of keys) {
    prev[k] = process.env[k]
    if (overrides[k] === undefined) delete process.env[k]
    else process.env[k] = overrides[k]
  }
  try {
    return fn()
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k]
      else process.env[k] = prev[k]
    }
  }
}

function loadSmoke() {
  delete require.cache[require.resolve("../src/ciIntent")]
  delete require.cache[require.resolve("../src/feedUrl")]
  delete require.cache[require.resolve("../src/smoke")]
  return require("../src/smoke")
}

test("smoke is off unless AFTERTRACE_SMOKE=1 and CI/test intent", () => {
  withEnv(
    {
      AFTERTRACE_SMOKE: undefined,
      AFTERTRACE_SMOKE_ALLOW: undefined,
      GITHUB_ACTIONS: undefined,
      RUNNER_TEMP: undefined,
      GITHUB_WORKSPACE: undefined,
    },
    () => {
      const smoke = loadSmoke()
      assert.equal(smoke.enabled(), false)
      process.env.AFTERTRACE_SMOKE = "1"
      assert.equal(smoke.enabled(), false)
      process.env.AFTERTRACE_SMOKE_ALLOW = "1"
      assert.equal(smoke.enabled(), true)
    },
  )
})

test("GITHUB_ACTIONS without a runner workspace is not enough", () => {
  withEnv(
    {
      AFTERTRACE_SMOKE: "1",
      AFTERTRACE_SMOKE_ALLOW: undefined,
      GITHUB_ACTIONS: "true",
      RUNNER_TEMP: undefined,
      GITHUB_WORKSPACE: undefined,
    },
    () => {
      const smoke = loadSmoke()
      assert.equal(smoke.enabled(), false)
    },
  )
})

test("applyPaths ignores AFTERTRACE_USER_DATA_DIR without smoke intent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aftertrace-ud-"))
  const seen = []
  withEnv(
    {
      AFTERTRACE_SMOKE: undefined,
      AFTERTRACE_SMOKE_ALLOW: undefined,
      GITHUB_ACTIONS: undefined,
      AFTERTRACE_USER_DATA_DIR: dir,
    },
    () => {
      const smoke = loadSmoke()
      smoke.applyPaths({ setPath: (k, v) => seen.push([k, v]) })
      assert.deepEqual(seen, [])
    },
  )
  fs.rmSync(dir, { recursive: true, force: true })
})

test("start without AFTERTRACE_SMOKE_DIR does not write tmp", () => {
  withEnv(
    {
      AFTERTRACE_SMOKE: "1",
      AFTERTRACE_SMOKE_ALLOW: "1",
      AFTERTRACE_SMOKE_DIR: undefined,
    },
    () => {
      const smoke = loadSmoke()
      const got = smoke.start({})
      assert.equal(got.skipped, true)
      assert.equal(got.reason, "AFTERTRACE_SMOKE_DIR required")
      const fallback = path.join(os.tmpdir(), "aftertrace-smoke")
      assert.equal(fs.existsSync(path.join(fallback, "status.json")), false)
    },
  )
})

test("file-protocol cmd check/restart/close/menu does not use Playwright", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aftertrace-smoke-"))
  const prev = {
    AFTERTRACE_SMOKE: process.env.AFTERTRACE_SMOKE,
    AFTERTRACE_SMOKE_ALLOW: process.env.AFTERTRACE_SMOKE_ALLOW,
    AFTERTRACE_SMOKE_DIR: process.env.AFTERTRACE_SMOKE_DIR,
  }
  process.env.AFTERTRACE_SMOKE = "1"
  process.env.AFTERTRACE_SMOKE_ALLOW = "1"
  process.env.AFTERTRACE_SMOKE_DIR = dir
  const events = new EventEmitter()
  const seen = { close: 0, popover: 0, menu: 0 }
  try {
    const smoke = loadSmoke()
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
    smoke.start({
      updater,
      getVersion: () => "0.5.4",
      getUserData: () => "/tmp/aftertrace-user",
      restartToUpdate: () => events.emit("restart"),
      closeWindow: () => {
        seen.close += 1
      },
      showPopover: () => {
        seen.popover += 1
      },
      showMenu: () => {
        seen.menu += 1
      },
      getMenuLabels: () => ["Idle", "Open Aftertrace"],
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
    fs.writeFileSync(path.join(dir, "cmd"), "close\n")
    await new Promise((r) => setTimeout(r, 400))
    assert.equal(seen.close, 1)
    fs.writeFileSync(path.join(dir, "cmd"), "popover\n")
    await new Promise((r) => setTimeout(r, 400))
    assert.equal(seen.popover, 1)
    fs.writeFileSync(path.join(dir, "cmd"), "menu\n")
    await new Promise((r) => setTimeout(r, 400))
    assert.equal(seen.menu, 1)
    const afterMenu = JSON.parse(fs.readFileSync(path.join(dir, "status.json"), "utf8"))
    assert.equal(afterMenu.menuOpen, true)
    assert.deepEqual(afterMenu.menuLabels, ["Idle", "Open Aftertrace"])
    fs.writeFileSync(path.join(dir, "cmd"), "hide-menu\n")
    await new Promise((r) => setTimeout(r, 400))
    const afterHide = JSON.parse(fs.readFileSync(path.join(dir, "status.json"), "utf8"))
    assert.equal(afterHide.menuOpen, false)
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    delete require.cache[require.resolve("../src/smoke")]
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
