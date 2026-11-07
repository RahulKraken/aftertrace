"use strict"

const fs = require("fs")
const path = require("path")
const os = require("os")
const { aftertraceDir } = require("./paths")
const { localGenericFeedUrl } = require("./feedUrl")

function enabled() {
  return process.env.AFTERTRACE_SMOKE === "1"
}

function smokeDir() {
  return process.env.AFTERTRACE_SMOKE_DIR || path.join(os.tmpdir(), "aftertrace-smoke")
}

function statusPath() {
  return path.join(smokeDir(), "status.json")
}

function cmdPath() {
  return path.join(smokeDir(), "cmd")
}

function applyPaths(app) {
  const userData = process.env.AFTERTRACE_USER_DATA_DIR
  if (userData) {
    fs.mkdirSync(userData, { recursive: true })
    app.setPath("userData", userData)
  }
}

function writeStatus(extra = {}) {
  fs.mkdirSync(smokeDir(), { recursive: true })
  const body = {
    ts: new Date().toISOString(),
    pid: process.pid,
    version: extra.version || null,
    update: extra.update || null,
    userData: extra.userData || null,
    homedir: os.homedir(),
    envHome: process.env.HOME || "",
    aftertraceDir: aftertraceDir(),
    feed: localGenericFeedUrl(),
    ...extra,
  }
  fs.writeFileSync(statusPath(), `${JSON.stringify(body, null, 2)}\n`)
}

function start({ updater, openWindow, restartToUpdate, getVersion, getUserData } = {}) {
  if (!enabled()) return { skipped: true }
  fs.mkdirSync(smokeDir(), { recursive: true })
  try {
    fs.unlinkSync(cmdPath())
  } catch {
    // first run
  }
  const tick = () => {
    writeStatus({
      version: getVersion ? getVersion() : null,
      update: updater ? updater.getState() : null,
      userData: getUserData ? getUserData() : null,
    })
    let raw = ""
    try {
      raw = fs.readFileSync(cmdPath(), "utf8").trim()
    } catch {
      return
    }
    if (!raw) return
    try {
      fs.unlinkSync(cmdPath())
    } catch {
      // consumed
    }
    const cmd = raw.split(/\s+/)[0]
    if (cmd === "check" && updater) {
      updater.check({ interactive: false }).catch((err) => {
        writeStatus({
          version: getVersion ? getVersion() : null,
          update: updater.getState(),
          error: err && err.message,
        })
      })
    } else if (cmd === "restart" && restartToUpdate) {
      restartToUpdate()
    } else if (cmd === "dashboard" && openWindow) {
      openWindow()
    } else if (cmd === "quit") {
      const { app } = require("electron")
      app.quit()
    }
  }
  tick()
  const t = setInterval(tick, 250)
  if (typeof t.unref === "function") t.unref()
  if (updater && typeof updater.subscribe === "function") {
    updater.subscribe(() => tick())
  }
  return { skipped: false, statusPath: statusPath() }
}

module.exports = { enabled, smokeDir, statusPath, cmdPath, applyPaths, writeStatus, start }
