"use strict"

const { dialog, app } = require("electron")
const { gt, parse } = require("./semver")

const IDLE = "idle"
const CHECKING = "checking"
const AVAILABLE = "available"
const DOWNLOADING = "downloading"
const READY = "ready"
const ERROR = "error"
const CURRENT = "current"

function getAutoUpdater() {
  const mod = require("electron-updater")
  return mod.autoUpdater
}

function feedCompatible(info, arch = process.arch, platform = process.platform) {
  if (platform !== "darwin") return { ok: true }
  const files = (info && info.files) || []
  if (!files.length) return { ok: true }
  const names = files.map((f) => String((f && (f.url || f.path)) || ""))
  if (arch === "arm64") {
    const hit = names.some((n) => /arm64/i.test(n) && /\.zip$/i.test(n))
    if (!hit) return { ok: false, reason: "feed has no arm64 zip" }
    return { ok: true }
  }
  return { ok: false, reason: "Intel Mac is not a consumer update target" }
}

function sanitizeLog(x) {
  return String(x)
    .replace(/ghp_[A-Za-z0-9]+/g, "ghp_***")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "github_pat_***")
}

function createUpdater(deps = {}) {
  const autoUpdater = deps.autoUpdater || getAutoUpdater()
  const getVersion = deps.getVersion || (() => app.getVersion())
  const showDialog = deps.dialog || dialog
  const platform = deps.platform || process.platform
  const arch = deps.arch || process.arch
  const listeners = new Set()

  let state = { status: IDLE, version: null, current: getVersion(), error: null }
  let wired = false
  let checking = null

  const emit = () => {
    for (const fn of listeners) {
      try {
        fn(getState())
      } catch {
        // a subscriber must not take the updater down
      }
    }
  }

  const setState = (next) => {
    state = { ...state, current: getVersion(), ...next }
    emit()
  }

  const wire = () => {
    if (wired) return
    wired = true
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.autoRunAppAfterInstall = false
    autoUpdater.allowDowngrade = false
    autoUpdater.allowPrerelease = false
    if (!autoUpdater.logger) {
      autoUpdater.logger = {
        info() {},
        warn() {},
        debug() {},
        error(...args) {
          console.error("[updater]", ...args.map(sanitizeLog))
        },
      }
    }
    autoUpdater.on("error", (err) => {
      const msg = err && err.message ? String(err.message) : "update check failed"
      if (state.status === DOWNLOADING || state.status === AVAILABLE || state.status === CHECKING) {
        setState({ status: ERROR, error: msg })
      }
    })
    autoUpdater.on("update-downloaded", (info) => {
      const version = (info && info.version) || state.version
      setState({ status: READY, version, error: null })
    })
  }

  function getState() {
    return { ...state }
  }

  function subscribe(fn) {
    listeners.add(fn)
    fn(getState())
    return () => listeners.delete(fn)
  }

  async function check({ interactive = false } = {}) {
    wire()
    if (state.status === DOWNLOADING) {
      if (interactive) {
        await showDialog.showMessageBox({
          type: "info",
          message: "Downloading update",
          detail: state.version ? `Aftertrace ${state.version} is downloading. The app stays open.` : "The download is in progress.",
        })
      }
      return getState()
    }
    if (state.status === READY) {
      if (interactive) {
        const { response } = await showDialog.showMessageBox({
          type: "info",
          message: `Aftertrace ${state.version} is ready`,
          detail: `You have ${getVersion()}. Restart when you want the new build. Work is not interrupted until then.`,
          buttons: ["Restart to update", "Later"],
          defaultId: 0,
          cancelId: 1,
        })
        if (response === 0) return { ...getState(), restart: true }
      }
      return getState()
    }

    setState({ status: CHECKING, error: null })
    try {
      const result = await autoUpdater.checkForUpdates()
      const info = result && result.updateInfo
      const latest = info && info.version
      const current = getVersion()
      if (!parse(latest) || !gt(latest, current)) {
        setState({ status: CURRENT, version: latest || current, error: null })
        if (interactive) {
          await showDialog.showMessageBox({
            type: "info",
            message: "Aftertrace is up to date",
            detail: `This is ${current}.`,
          })
        }
        return getState()
      }
      const compat = feedCompatible(info, arch, platform)
      if (!compat.ok) {
        setState({ status: ERROR, version: latest, error: compat.reason })
        if (interactive) {
          await showDialog.showMessageBox({
            type: "info",
            message: "Update not compatible",
            detail: compat.reason,
          })
        }
        return getState()
      }
      setState({ status: AVAILABLE, version: latest, error: null })
      if (interactive) {
        const { response } = await showDialog.showMessageBox({
          type: "info",
          message: `Aftertrace ${latest} is available`,
          detail: `You have ${current}. Aftertrace can download it in the background. You choose when to restart.`,
          buttons: ["Download", "Later"],
          defaultId: 0,
          cancelId: 1,
        })
        if (response !== 0) return getState()
      }
      setState({ status: DOWNLOADING, version: latest, error: null })
      await autoUpdater.downloadUpdate()
      setState({ status: READY, version: latest, error: null })
      return getState()
    } catch (err) {
      const message = err && err.message ? String(err.message) : "update check failed"
      setState({ status: ERROR, error: message })
      if (interactive) {
        await showDialog.showMessageBox({
          type: "info",
          message: "Could not check for updates",
          detail: "Aftertrace looked at GitHub Releases. Nothing else left this machine. Try again when you are online.",
        })
      }
      return getState()
    }
  }

  function checkSerialized(opts) {
    if (checking) return checking
    checking = check(opts).finally(() => {
      checking = null
    })
    return checking
  }

  function startBackgroundChecks() {
    wire()
    const run = () => {
      checkSerialized({ interactive: false }).catch(() => {})
    }
    setTimeout(run, 20_000).unref?.()
    setInterval(run, 4 * 60 * 60 * 1000).unref?.()
  }

  function requestInstall({ relaunch = true } = {}) {
    wire()
    if (state.status !== READY) return false
    autoUpdater.quitAndInstall(false, Boolean(relaunch))
    return true
  }

  return {
    IDLE,
    CHECKING,
    AVAILABLE,
    DOWNLOADING,
    READY,
    ERROR,
    CURRENT,
    getState,
    subscribe,
    check: checkSerialized,
    startBackgroundChecks,
    requestInstall,
    feedCompatible,
    wire,
    autoUpdater,
  }
}

let singleton = null

function getUpdater() {
  if (!singleton) singleton = createUpdater()
  return singleton
}

function checkForUpdates(opts) {
  return getUpdater().check(opts)
}

function startBackgroundChecks() {
  return getUpdater().startBackgroundChecks()
}

module.exports = {
  createUpdater,
  getUpdater,
  checkForUpdates,
  startBackgroundChecks,
  getAutoUpdater,
  feedCompatible,
  IDLE,
  CHECKING,
  AVAILABLE,
  DOWNLOADING,
  READY,
  ERROR,
  CURRENT,
}
