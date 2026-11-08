"use strict"

const fs = require("fs")
const path = require("path")
const os = require("os")
const { aftertraceDir } = require("./paths")
const { localGenericFeedUrl } = require("./feedUrl")
const { ciIntent } = require("./ciIntent")

function enabled() {
  return process.env.AFTERTRACE_SMOKE === "1" && ciIntent()
}

function smokeDir() {
  return process.env.AFTERTRACE_SMOKE_DIR || ""
}

function statusPath() {
  return path.join(smokeDir(), "status.json")
}

function cmdPath() {
  return path.join(smokeDir(), "cmd")
}

function applyPaths(app) {
  if (!enabled()) return
  const userData = process.env.AFTERTRACE_USER_DATA_DIR
  if (userData) {
    fs.mkdirSync(userData, { recursive: true })
    app.setPath("userData", userData)
  }
}

function writeStatus(extra = {}) {
  const dir = smokeDir()
  if (!dir) return
  fs.mkdirSync(dir, { recursive: true })
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

function start({
  updater,
  openWindow,
  closeWindow,
  showPopover,
  hidePopover,
  showMenu,
  getMenuLabels,
  refreshTray,
  getWindowHash,
  restartToUpdate,
  getVersion,
  getUserData,
  getTrayBounds,
  getPopoverBounds,
} = {}) {
  if (!enabled()) return { skipped: true }
  if (!process.env.AFTERTRACE_SMOKE_DIR) {
    return { skipped: true, reason: "AFTERTRACE_SMOKE_DIR required" }
  }
  fs.mkdirSync(smokeDir(), { recursive: true })
  try {
    fs.unlinkSync(cmdPath())
  } catch {
    // first run
  }
  let menuOpen = false
  const snapshot = (more = {}) => ({
    version: getVersion ? getVersion() : null,
    update: updater ? updater.getState() : null,
    userData: getUserData ? getUserData() : null,
    trayBounds: getTrayBounds ? getTrayBounds() : null,
    popoverBounds: getPopoverBounds ? getPopoverBounds() : null,
    popoverOpen: Boolean(getPopoverBounds && getPopoverBounds()),
    menuOpen,
    menuLabels: getMenuLabels ? getMenuLabels() : [],
    windowHash: getWindowHash ? getWindowHash() : null,
    ...more,
  })
  const tick = () => {
    writeStatus(snapshot())
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
        writeStatus(snapshot({ error: err && err.message }))
      })
    } else if (cmd === "restart" && restartToUpdate) {
      restartToUpdate()
    } else if (cmd === "dashboard" && openWindow) {
      openWindow()
    } else if (cmd === "close" && closeWindow) {
      closeWindow()
    } else if (cmd === "menu" && showMenu) {
      // popUpContextMenu often returns immediately on Darwin (Electron 45).
      // Keep menuOpen until hide-menu so the runner can screenshot.
      menuOpen = true
      writeStatus(snapshot())
      setImmediate(() => {
        try {
          showMenu()
        } catch (err) {
          writeStatus(snapshot({ error: err && err.message }))
        }
      })
    } else if (cmd === "hide-menu") {
      menuOpen = false
      writeStatus(snapshot())
    } else if (cmd === "refresh" && refreshTray) {
      Promise.resolve(refreshTray())
        .then(() => writeStatus(snapshot()))
        .catch((err) => writeStatus(snapshot({ error: err && err.message })))
    } else if (cmd === "popover" && showPopover) {
      showPopover()
    } else if (cmd === "hide-popover" && hidePopover) {
      hidePopover()
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
