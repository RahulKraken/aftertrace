"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const settings = require("../src/settings")

test("persists notified update version and last check", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aftertrace-settings-"))
  const first = settings.save(dir, { notifiedUpdateVersion: "0.5.7", updateCheckedAt: 123 })
  assert.equal(first.notifiedUpdateVersion, "0.5.7")
  assert.equal(first.updateCheckedAt, 123)
  const loaded = settings.load(dir)
  assert.equal(loaded.notifiedUpdateVersion, "0.5.7")
  assert.equal(loaded.updateCheckedAt, 123)
  assert.equal(loaded.firstLaunchDone, false)
})
