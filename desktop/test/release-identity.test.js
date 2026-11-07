"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const path = require("path")
const {
  checkIdentity,
  checkRepo,
  tagVersion,
  ymlVersion,
  changelogHasVersion,
  plistString,
} = require("../scripts/release-identity.cjs")
const fs = require("fs")

const feed = (version) =>
  `version: ${version}\nfiles:\n  - url: Aftertrace-mac-arm64.zip\npath: Aftertrace-mac-arm64.zip\n`

test("tagVersion reads vX.Y.Z refs", () => {
  assert.equal(tagVersion("refs/tags/v0.5.4").raw, "0.5.4")
  assert.equal(tagVersion("v0.5.4").raw, "0.5.4")
  assert.equal(tagVersion("refs/heads/main"), null)
})

test("ymlVersion reads the feed version line", () => {
  assert.equal(ymlVersion(feed("0.5.4")).raw, "0.5.4")
})

test("v0.5.3-style mismatch fails closed", () => {
  const r = checkIdentity({
    packageVersion: "0.5.0",
    githubRef: "refs/tags/v0.5.3",
    macYml: feed("0.5.0"),
    changelog: "## Unreleased\n",
    floorVersion: "0.5.0",
  })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => /tag v0\.5\.3 does not match package.json 0\.5\.0/.test(e)))
  assert.ok(r.errors.some((e) => /newer than 0\.5\.0/.test(e)))
})

test("tag, package, feed, and changelog must agree", () => {
  const r = checkIdentity({
    packageVersion: "0.5.4",
    githubRef: "refs/tags/v0.5.4",
    macYml: feed("0.5.4"),
    winYml: "version: 0.5.4\n",
    changelog: "## Unreleased\n\n## v0.5.4\n\n- menu bar\n",
    floorVersion: "0.5.0",
  })
  assert.equal(r.ok, true, r.errors.join("; "))
})

test("feed version drifting from package.json fails", () => {
  const r = checkIdentity({
    packageVersion: "0.5.4",
    macYml: feed("0.5.0"),
    floorVersion: "0.5.0",
  })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => /latest-mac.yml version 0\.5\.0/.test(e)))
})

test("x64 zip in the Mac feed fails", () => {
  const r = checkIdentity({
    packageVersion: "0.5.4",
    macYml: "version: 0.5.4\nfiles:\n  - url: Aftertrace-mac-x64.zip\npath: Aftertrace-mac-x64.zip\n",
    floorVersion: "0.5.0",
  })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => /arm64/.test(e) || /x64/.test(e)))
})

test("this repo's package.json is newer than the shipped 0.5.0 app", () => {
  const r = checkRepo(path.join(__dirname, "..", ".."), { floorVersion: "0.5.0" })
  assert.equal(r.ok, true, r.errors.join("; "))
  assert.ok(r.packageVersion)
  const [maj, min, pat] = r.packageVersion.split(".").map(Number)
  assert.ok(maj > 0 || min > 5 || (min === 5 && pat > 0))
})

test("CHANGELOG.md has a heading for this package version", () => {
  const root = path.join(__dirname, "..", "..")
  const pkg = require("../package.json").version
  const md = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8")
  assert.equal(changelogHasVersion(md, pkg), true)
})

test("packed app Info.plist must match package.json", () => {
  const r = checkIdentity({
    packageVersion: "0.5.4",
    macYml: feed("0.5.4"),
    appVersion: "0.5.0",
    floorVersion: "0.5.0",
  })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => /CFBundleShortVersionString 0\.5\.0/.test(e)))
})

test("plistString reads CFBundleShortVersionString", () => {
  const xml = `<?xml version="1.0"?>
<plist><dict><key>CFBundleShortVersionString</key><string>0.5.4</string></dict></plist>`
  assert.equal(plistString(xml, "CFBundleShortVersionString"), "0.5.4")
})
