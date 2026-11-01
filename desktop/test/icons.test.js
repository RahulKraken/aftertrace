"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const path = require("path")

const root = path.join(__dirname, "../resources")

test("desktop icon set is present for every pack target", () => {
  const files = [
    "icon.icns",
    "icon.ico",
    "icon.png",
    "linux-icons/16x16.png",
    "linux-icons/32x32.png",
    "linux-icons/48x48.png",
    "linux-icons/128x128.png",
    "linux-icons/256x256.png",
    "linux-icons/512x512.png",
    "linux-icons/aftertrace.svg",
    "icons/icon.png",
    "icons/trayTemplate.png",
    "icons/trayTemplate@2x.png",
    "icons/tray-22.png",
    "icons/tray-22@2x.png",
    "icons/tray-22-light.png",
    "icons/tray-22-light@2x.png",
    "icons/tray-16.png",
    "icons/tray-16@2x.png",
    "icons/tray-16-light.png",
    "icons/tray-16-light@2x.png",
  ]
  for (const f of files) {
    assert.ok(fs.existsSync(path.join(root, f)), f)
  }
})
