"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { desktopEntry, applyLinux } = require("../src/autostart")

test("linux desktop file starts hidden", () => {
  const body = desktopEntry({ execPath: "/opt/Aftertrace/aftertrace", hidden: true })
  assert.match(body, /^\[Desktop Entry\]/m)
  assert.match(body, /Name=Aftertrace/)
  assert.match(body, /Exec="\/opt\/Aftertrace\/aftertrace" --hidden/)
  assert.match(body, /X-GNOME-Autostart-enabled=true/)
  assert.doesNotMatch(body, /security|audit/i)
})

test("applyLinux writes and removes the autostart file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aftertrace-autostart-"))
  const prev = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = dir
  try {
    const { file } = applyLinux(true, "/tmp/Aftertrace")
    assert.equal(fs.existsSync(file), true)
    const body = fs.readFileSync(file, "utf8")
    assert.match(body, /Exec="\/tmp\/Aftertrace" --hidden/)
    applyLinux(false, "/tmp/Aftertrace")
    assert.equal(fs.existsSync(file), false)
  } finally {
    process.env.XDG_CONFIG_HOME = prev
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
