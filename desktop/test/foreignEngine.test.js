"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const {
  launchdPlistPath,
  isForeignOccupant,
  occupantError,
  migrateLegacyService,
} = require("../src/foreignEngine")

test("a v0.4.2 launchd occupant is foreign to 0.5.5", () => {
  assert.equal(isForeignOccupant({ version: "v0.4.2", service: "launchd" }, "v0.5.5"), true)
  assert.equal(isForeignOccupant({ version: "v0.5.5", service: "" }, "v0.5.5"), false)
  assert.equal(isForeignOccupant({ version: "v0.5.5", service: "launchd" }, "v0.5.5"), true)
})

test("occupant error names the old version and keeps the database", () => {
  const msg = occupantError({ version: "v0.4.2" })
  assert.match(msg, /v0\.4\.2/)
  assert.match(msg, /database is kept/)
})

test("migrateLegacyService boots out launchd and removes the plist, not the DB", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "aftertrace-la-"))
  const agents = path.join(home, "Library", "LaunchAgents")
  fs.mkdirSync(agents, { recursive: true })
  const plist = launchdPlistPath(home)
  fs.writeFileSync(plist, "<plist/>")
  const db = path.join(home, ".aftertrace", "aftertrace.duckdb")
  fs.mkdirSync(path.dirname(db), { recursive: true })
  fs.writeFileSync(db, "keep")
  const cmds = []
  try {
    const r = migrateLegacyService({
      platform: "darwin",
      home,
      uid: 501,
      spawnSyncFn: (bin, args) => {
        cmds.push([bin, ...args])
        return { status: 0, stderr: "" }
      },
    })
    assert.equal(r.ok, true)
    assert.deepEqual(cmds[0], ["launchctl", "bootout", "gui/501/dev.aftertrace"])
    assert.equal(fs.existsSync(plist), false)
    assert.equal(fs.readFileSync(db, "utf8"), "keep")
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})
