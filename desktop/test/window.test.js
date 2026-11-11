"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const Module = require("module")

const orig = Module._load
Module._load = function (request, parent, isMain) {
  if (request === "electron") {
    return {
      BrowserWindow: class BrowserWindow {},
      nativeTheme: { shouldUseDarkColors: false },
    }
  }
  return orig.apply(this, arguments)
}

const { dashboardWindowOptions, settingsWindowOptions } = require("../src/window")

test("dashboard window keeps traffic lights in the sidebar on Mac", () => {
  const opts = dashboardWindowOptions()
  assert.equal(opts.width, 1280)
  assert.equal(opts.minWidth, 960)
  if (process.platform === "darwin") {
    assert.equal(opts.titleBarStyle, "hiddenInset")
    assert.deepEqual(opts.trafficLightPosition, { x: 20, y: 18 })
    assert.equal(opts.vibrancy, "sidebar")
    assert.equal(opts.transparent, true)
  }
  assert.ok(opts.webPreferences.additionalArguments.includes("--aftertrace-window=dashboard"))
})

test("settings is a separate smaller window", () => {
  const opts = settingsWindowOptions()
  assert.equal(opts.width, 720)
  assert.equal(opts.height, 640)
  assert.ok(opts.webPreferences.additionalArguments.includes("--aftertrace-window=settings"))
  if (process.platform === "darwin") {
    assert.equal(opts.titleBarStyle, "hiddenInset")
  }
})
