"use strict"

const { describe, it, beforeEach, afterEach } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const {
  inspectContents,
  assertMacBundleLayout,
  assertPackagedLicense,
  licensePathFor,
} = require("../scripts/mac-bundle-layout.cjs")

let root

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "aftertrace-bundle-"))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function appTree({ licenseInResources = true, licenseAtContents = false, extraFile } = {}) {
  const app = path.join(root, "Aftertrace.app")
  const contents = path.join(app, "Contents")
  fs.mkdirSync(path.join(contents, "MacOS"), { recursive: true })
  fs.mkdirSync(path.join(contents, "Resources", "engine"), { recursive: true })
  fs.mkdirSync(path.join(contents, "Frameworks"), { recursive: true })
  fs.writeFileSync(path.join(contents, "Info.plist"), "<plist/>")
  fs.writeFileSync(path.join(contents, "PkgInfo"), "APPL????")
  fs.writeFileSync(path.join(contents, "MacOS", "Aftertrace"), "bin")
  fs.writeFileSync(path.join(contents, "Resources", "engine", "aftertrace"), "engine")
  if (licenseInResources) fs.writeFileSync(path.join(contents, "Resources", "LICENSE"), "Apache-2.0\n")
  if (licenseAtContents) fs.writeFileSync(path.join(contents, "LICENSE"), "Apache-2.0\n")
  if (extraFile) fs.writeFileSync(path.join(contents, extraFile), "x")
  return app
}

describe("mac bundle layout", () => {
  it("rejects Contents/LICENSE — the v0.5.1 codesign failure", () => {
    const app = appTree({ licenseAtContents: true, licenseInResources: true })
    const { unexpectedFiles } = inspectContents(path.join(app, "Contents"))
    assert.deepEqual(unexpectedFiles, ["LICENSE"])
    assert.throws(() => assertMacBundleLayout(app), /Contents\/LICENSE/)
  })

  it("rejects any other loose file at Contents/", () => {
    const app = appTree({ extraFile: "README" })
    assert.throws(() => assertMacBundleLayout(app), /unsigned nested files/)
  })

  it("accepts a sealed layout with LICENSE under Resources", () => {
    const app = appTree()
    assertMacBundleLayout(app)
    assert.equal(licensePathFor("darwin", app), path.join(app, "Contents", "Resources", "LICENSE"))
  })

  it("requires a non-empty Resources/LICENSE", () => {
    const app = appTree({ licenseInResources: false })
    assert.throws(() => assertMacBundleLayout(app), /LICENSE missing/)
  })

  it("requires resources/LICENSE on Windows and Linux", () => {
    const unpacked = path.join(root, "linux-unpacked")
    fs.mkdirSync(path.join(unpacked, "resources"), { recursive: true })
    assert.throws(() => assertPackagedLicense("linux", unpacked), /LICENSE missing/)
    fs.writeFileSync(path.join(unpacked, "resources", "LICENSE"), "Apache-2.0\n")
    assertPackagedLicense("linux", unpacked)
    assertPackagedLicense("win32", unpacked)
  })
})

describe("electron-builder.yml", () => {
  it("ships LICENSE via extraResources, not extraFiles", () => {
    const yml = fs.readFileSync(path.join(__dirname, "..", "electron-builder.yml"), "utf8")
    assert.doesNotMatch(yml, /^extraFiles:/m)
    assert.match(yml, /from: \.\.\/LICENSE/)
    const resources = yml.split("extraResources:")[1] || ""
    const afterMac = resources.split(/\nwin:|\nlinux:|\nmac:/)[0]
    assert.match(afterMac, /to: LICENSE/)
  })
})
