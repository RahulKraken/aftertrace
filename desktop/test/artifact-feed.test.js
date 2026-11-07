"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { checkDist, sha512Base64 } = require("../scripts/artifact-feed.cjs")

const root = path.join(__dirname, "..", "..")
const pkg = require("../package.json").version

function writePlist(dir, version) {
  const app = path.join(dir, "mac-arm64", "Aftertrace.app", "Contents")
  fs.mkdirSync(path.join(app, "Resources"), { recursive: true })
  fs.writeFileSync(
    path.join(app, "Info.plist"),
    `<?xml version="1.0"?>\n<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>\n`,
  )
}

test("artifact-feed accepts a matching packed app, yml, and zip sha", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aftertrace-feed-ok-"))
  writePlist(dir, pkg)
  const zip = path.join(dir, "Aftertrace-mac-arm64.zip")
  fs.writeFileSync(zip, "zip-bytes")
  const sha = sha512Base64(zip)
  fs.writeFileSync(
    path.join(dir, "latest-mac.yml"),
    `version: ${pkg}\nfiles:\n  - url: Aftertrace-mac-arm64.zip\n    sha512: ${sha}\n    size: 9\npath: Aftertrace-mac-arm64.zip\nsha512: ${sha}\n`,
  )
  const r = checkDist(root, dir)
  assert.equal(r.ok, true, r.errors.join("; "))
  assert.equal(r.report.zipShaOk, true)
  assert.equal(r.report.feedVersion, pkg)
  assert.equal(r.report.appVersions[0].version, pkg)
  assert.equal(r.report.newerThanFloor, true)
})

test("artifact-feed fails when Info.plist is the shipped 0.5.0 identity", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aftertrace-feed-old-"))
  writePlist(dir, "0.5.0")
  fs.writeFileSync(path.join(dir, "latest-mac.yml"), `version: ${pkg}\nfiles:\n  - url: Aftertrace-mac-arm64.zip\npath: Aftertrace-mac-arm64.zip\n`)
  const r = checkDist(root, dir)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => /CFBundleShortVersionString 0\.5\.0/.test(e)))
})
