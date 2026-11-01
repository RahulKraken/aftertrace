"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { enginePath, ENGINE_NAME } = require("../src/paths")

test("packaged extraResources wins", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aftertrace-paths-"))
  const resources = path.join(root, "resources")
  fs.mkdirSync(path.join(resources, "engine"), { recursive: true })
  const bin = path.join(resources, "engine", ENGINE_NAME)
  fs.writeFileSync(bin, "")
  try {
    assert.equal(enginePath({ isPackaged: true, resourcesPath: resources, appPath: root }), bin)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("falls back to a repo-root go build", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aftertrace-paths-"))
  const desktop = path.join(root, "desktop")
  fs.mkdirSync(desktop)
  const bin = path.join(root, ENGINE_NAME)
  fs.writeFileSync(bin, "")
  try {
    assert.equal(enginePath({ isPackaged: false, resourcesPath: path.join(desktop, "nope"), appPath: desktop }), bin)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
