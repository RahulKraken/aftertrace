"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const { finishQuit } = require("../src/quit")

test("Restart to update stops the sidecar then quitAndInstall, not a bare quit", async () => {
  const calls = []
  const r = await finishQuit({
    stopEngine: async () => {
      calls.push("stop")
    },
    restartingForUpdate: true,
    requestInstall: () => {
      calls.push("install")
      return true
    },
    quit: () => {
      calls.push("quit")
    },
  })
  assert.equal(r, "install")
  assert.deepEqual(calls, ["stop", "install"])
})

test("ordinary quit installs a pending update without relaunch", async () => {
  const calls = []
  const r = await finishQuit({
    stopEngine: async () => {
      calls.push("stop")
    },
    restartingForUpdate: false,
    requestInstall: (opts) => {
      calls.push(opts)
      return true
    },
    quit: () => {
      calls.push("quit")
    },
  })
  assert.equal(r, "install")
  assert.deepEqual(calls, ["stop", { relaunch: false }])
})

test("ordinary quit with no pending update is a bare quit", async () => {
  const calls = []
  const r = await finishQuit({
    stopEngine: async () => {
      calls.push("stop")
    },
    restartingForUpdate: false,
    requestInstall: () => {
      calls.push("install")
      return false
    },
    quit: () => {
      calls.push("quit")
    },
  })
  assert.equal(r, "quit")
  assert.deepEqual(calls, ["stop", "install", "quit"])
})
