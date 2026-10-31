"use strict"

const fs = require("fs")
const path = require("path")

const DEFAULTS = {
  firstLaunchDone: false,
  openAtLogin: false,
}

function settingsPath(userData) {
  return path.join(userData, "desktop.json")
}

function load(userData) {
  const file = settingsPath(userData)
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"))
    return {
      firstLaunchDone: Boolean(raw.firstLaunchDone),
      openAtLogin: Boolean(raw.openAtLogin),
    }
  } catch {
    return { ...DEFAULTS }
  }
}

function save(userData, next) {
  const file = settingsPath(userData)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const cur = { ...DEFAULTS, ...load(userData), ...next }
  fs.writeFileSync(file, JSON.stringify(cur, null, 2) + "\n")
  return cur
}

module.exports = { load, save, settingsPath, DEFAULTS }
