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

test("ordinary quit stops the sidecar and does not install", async () => {
  const calls = []
  const r = await finishQuit({
    stopEngine: async () => {
      calls.push("stop")
    },
    restartingForUpdate: false,
    requestInstall: () => {
      calls.push("install")
      return true
    },
    quit: () => {
      calls.push("quit")
    },
  })
  assert.equal(r, "quit")
  assert.deepEqual(calls, ["stop", "quit"])
})
