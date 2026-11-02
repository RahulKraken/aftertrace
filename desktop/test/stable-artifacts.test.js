"use strict"

const { describe, it, beforeEach, afterEach } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { run } = require("../scripts/stable-artifacts.cjs")

let dir

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "aftertrace-stable-"))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function write(name, body = "x") {
  fs.writeFileSync(path.join(dir, name), body)
}

describe("stable-artifacts", () => {
  it("copies versioned names when builder already used stable names", () => {
    write("Aftertrace-mac.dmg", "dmg")
    write("Aftertrace-mac.zip", "zip")
    write(
      "latest-mac.yml",
      "version: 0.5.0\nfiles:\n  - url: Aftertrace-mac.zip\npath: Aftertrace-mac.zip\n",
    )
    run(dir, "0.5.0")
    assert.equal(fs.readFileSync(path.join(dir, "Aftertrace-0.5.0-mac.dmg"), "utf8"), "dmg")
    assert.equal(fs.readFileSync(path.join(dir, "Aftertrace-0.5.0-mac.zip"), "utf8"), "zip")
    assert.match(fs.readFileSync(path.join(dir, "latest-mac.yml"), "utf8"), /Aftertrace-mac\.zip/)
  })

  it("renames versioned universal artifacts and rewrites latest-mac.yml", () => {
    write("Aftertrace-0.5.0-mac-universal.dmg", "dmg")
    write("Aftertrace-0.5.0-mac-universal.zip", "zip")
    write(
      "latest-mac.yml",
      "version: 0.5.0\nfiles:\n  - url: Aftertrace-0.5.0-mac-universal.zip\npath: Aftertrace-0.5.0-mac-universal.zip\n",
    )
    run(dir, "0.5.0")
    assert.equal(fs.readFileSync(path.join(dir, "Aftertrace-mac.dmg"), "utf8"), "dmg")
    assert.equal(fs.readFileSync(path.join(dir, "Aftertrace-mac.zip"), "utf8"), "zip")
    const yml = fs.readFileSync(path.join(dir, "latest-mac.yml"), "utf8")
    assert.match(yml, /url: Aftertrace-mac\.zip/)
    assert.match(yml, /path: Aftertrace-mac\.zip/)
    assert.doesNotMatch(yml, /mac-universal/)
  })

  it("writes latest.yml for Windows when electron-builder omitted it", () => {
    write("Aftertrace Setup 0.5.0.exe", "exe")
    run(dir, "0.5.0")
    assert.ok(fs.existsSync(path.join(dir, "Aftertrace-win.exe")))
    const yml = fs.readFileSync(path.join(dir, "latest.yml"), "utf8")
    assert.match(yml, /url: Aftertrace-win\.exe/)
    assert.match(yml, /version: 0\.5\.0/)
  })

  it("stabilizes Linux AppImage and deb", () => {
    write("Aftertrace-0.5.0-linux-x64.AppImage", "app")
    write("Aftertrace-0.5.0-linux-x64.deb", "deb")
    run(dir, "0.5.0")
    assert.ok(fs.existsSync(path.join(dir, "Aftertrace-linux.AppImage")))
    assert.ok(fs.existsSync(path.join(dir, "Aftertrace-linux.deb")))
    assert.ok(fs.existsSync(path.join(dir, "latest-linux.yml")))
  })
})
