"use strict"

const fs = require("fs")
const os = require("os")
const path = require("path")

const ENGINE_NAME = process.platform === "win32" ? "aftertrace.exe" : "aftertrace"

function packagedEngine(resourcesPath) {
  return path.join(resourcesPath, "engine", ENGINE_NAME)
}

function repoEngine(appPath) {
  return path.join(appPath, "..", ENGINE_NAME)
}

function extraResourcesEngine(appPath) {
  return path.join(appPath, "resources", "engine", ENGINE_NAME)
}

/** Resolve the Go sidecar. Packaged first, then a local `go build` at the repo root. */
function enginePath({ isPackaged, resourcesPath, appPath } = {}) {
  const candidates = []
  if (resourcesPath) candidates.push(packagedEngine(resourcesPath))
  if (appPath) {
    candidates.push(extraResourcesEngine(appPath))
    candidates.push(repoEngine(appPath))
  }
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p
    } catch {
      // keep looking
    }
  }
  return ENGINE_NAME
}

function aftertraceDir() {
  return path.join(os.homedir(), ".aftertrace")
}

function engineLogPath() {
  return path.join(aftertraceDir(), "desktop-engine.log")
}

function linuxAutostartDir() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
  return path.join(base, "autostart")
}

function linuxAutostartFile() {
  return path.join(linuxAutostartDir(), "aftertrace.desktop")
}

function execForAutostart() {
  if (process.env.APPIMAGE) return process.env.APPIMAGE
  return process.execPath
}

module.exports = {
  ENGINE_NAME,
  enginePath,
  aftertraceDir,
  engineLogPath,
  linuxAutostartDir,
  linuxAutostartFile,
  execForAutostart,
  packagedEngine,
  repoEngine,
}
