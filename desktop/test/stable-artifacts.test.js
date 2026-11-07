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
  it("aliases Aftertrace-mac.dmg to arm64 and lists only the arm64 zip in latest-mac.yml", () => {
    write("Aftertrace-mac-arm64.dmg", "arm-dmg")
    write("Aftertrace-mac-x64.dmg", "x64-dmg")
    write("Aftertrace-mac-arm64.zip", "arm-zip")
    write("Aftertrace-mac-x64.zip", "x64-zip")
    write("Aftertrace-mac-arm64.zip.blockmap", "arm-block")
    write("Aftertrace-mac-x64.zip.blockmap", "x64-block")
    run(dir, "0.5.0")
    assert.equal(fs.readFileSync(path.join(dir, "Aftertrace-mac-arm64.dmg"), "utf8"), "arm-dmg")
    assert.equal(fs.readFileSync(path.join(dir, "Aftertrace-mac-x64.dmg"), "utf8"), "x64-dmg")
    assert.equal(fs.readFileSync(path.join(dir, "Aftertrace-mac.dmg"), "utf8"), "arm-dmg")
    assert.equal(fs.readFileSync(path.join(dir, "Aftertrace-0.5.0-mac.dmg"), "utf8"), "arm-dmg")
    assert.equal(fs.readFileSync(path.join(dir, "Aftertrace-0.5.0-mac-arm64.dmg"), "utf8"), "arm-dmg")
    assert.equal(fs.readFileSync(path.join(dir, "Aftertrace-0.5.0-mac-x64.dmg"), "utf8"), "x64-dmg")
    assert.equal(fs.readFileSync(path.join(dir, "Aftertrace-mac.zip"), "utf8"), "arm-zip")
    const yml = fs.readFileSync(path.join(dir, "latest-mac.yml"), "utf8")
    assert.match(yml, /url: Aftertrace-mac-arm64\.zip/)
    assert.doesNotMatch(yml, /url: Aftertrace-mac-x64\.zip/)
    assert.match(yml, /path: Aftertrace-mac-arm64\.zip/)
    assert.doesNotMatch(yml, /url: Aftertrace-mac\.zip\n/)
    assert.doesNotMatch(yml, /universal/)
  })

  it("renames versioned per-chip artifacts and rewrites latest-mac.yml", () => {
    write("Aftertrace-0.5.0-mac-arm64.dmg", "arm-dmg")
    write("Aftertrace-0.5.0-mac-x64.dmg", "x64-dmg")
    write("Aftertrace-0.5.0-mac-arm64.zip", "arm-zip")
    write("Aftertrace-0.5.0-mac-x64.zip", "x64-zip")
    write(
      "latest-mac.yml",
      "version: 0.5.0\nfiles:\n  - url: Aftertrace-0.5.0-mac-arm64.zip\npath: Aftertrace-0.5.0-mac-arm64.zip\n",
    )
    run(dir, "0.5.0")
    assert.equal(fs.readFileSync(path.join(dir, "Aftertrace-mac-arm64.dmg"), "utf8"), "arm-dmg")
    assert.equal(fs.readFileSync(path.join(dir, "Aftertrace-mac-x64.dmg"), "utf8"), "x64-dmg")
    assert.equal(fs.readFileSync(path.join(dir, "Aftertrace-mac.dmg"), "utf8"), "arm-dmg")
    const yml = fs.readFileSync(path.join(dir, "latest-mac.yml"), "utf8")
    assert.match(yml, /url: Aftertrace-mac-arm64\.zip/)
    assert.doesNotMatch(yml, /url: Aftertrace-mac-x64\.zip/)
    assert.doesNotMatch(yml, /0\.5\.0-mac-arm64\.zip/)
  })

  it("does not treat a lone Aftertrace-mac.dmg as enough — the arm64-named DMG is required", () => {
    write("Aftertrace-mac.dmg", "old")
    write("Aftertrace-mac.zip", "old-zip")
    assert.throws(() => run(dir, "0.5.0"), /Aftertrace-mac-arm64/)
  })

  it("Apple-silicon-only pack is enough without an Intel DMG", () => {
    write("Aftertrace-mac-arm64.dmg", "arm-dmg")
    write("Aftertrace-mac-arm64.zip", "arm-zip")
    run(dir, "0.5.0")
    assert.equal(fs.readFileSync(path.join(dir, "Aftertrace-mac.dmg"), "utf8"), "arm-dmg")
    const yml = fs.readFileSync(path.join(dir, "latest-mac.yml"), "utf8")
    assert.match(yml, /url: Aftertrace-mac-arm64\.zip/)
    assert.doesNotMatch(yml, /x64/)
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
