"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const { numericVersion, displayVersion, versionsMatch } = require("../src/releaseVersion")

test("displayVersion is always the release tag form", () => {
  assert.equal(displayVersion("0.5.5"), "v0.5.5")
  assert.equal(displayVersion("v0.5.5"), "v0.5.5")
  assert.equal(displayVersion(""), "")
})

test("versionsMatch ignores a leading v", () => {
  assert.equal(versionsMatch("v0.5.5", "0.5.5"), true)
  assert.equal(versionsMatch("v0.4.2", "v0.5.5"), false)
  assert.equal(versionsMatch("", "0.5.5"), false)
})

test("numericVersion strips the prefix", () => {
  assert.equal(numericVersion("v0.4.2"), "0.4.2")
})
