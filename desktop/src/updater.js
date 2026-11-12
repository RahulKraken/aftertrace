"use strict"

const { dialog, app } = require("electron")
const { gt, parse } = require("./semver")
const { localGenericFeedUrl } = require("./feedUrl")

const IDLE = "idle"
const CHECKING = "checking"
const AVAILABLE = "available"
const DOWNLOADING = "downloading"
const READY = "ready"
const ERROR = "error"
const CURRENT = "current"

const LAUNCH_DELAY_MS = 0
const HOUR_MS = 60 * 60 * 1000
const ONLINE_POLL_MS = 15_000

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

function numeric(raw) {
  return String(raw || "")
    .trim()
    .replace(/^v/i, "")
}

function defaultPersist() {
  return {
    load() {
      try {
        const settings = require("./settings")
        return settings.load(app.getPath("userData"))
      } catch {
        return {}
      }
    },
    save(next) {
      try {
        const settings = require("./settings")
        return settings.save(app.getPath("userData"), next)
      } catch {
        return next
      }
    },
  }
}

function defaultNotify({ title, onClick }) {
  try {
    const { Notification } = require("electron")
    if (typeof Notification !== "function") return null
    if (typeof Notification.isSupported === "function" && !Notification.isSupported()) return null
    const n = new Notification({ title, silent: false })
    if (onClick) n.on("click", onClick)
    n.show()
    return n
  } catch {
    return null
  }
}

function createUpdater(deps = {}) {
  const autoUpdater = deps.autoUpdater || getAutoUpdater()
  const getVersion = deps.getVersion || (() => app.getVersion())
  const showDialog = deps.dialog || dialog
  const platform = deps.platform || process.platform
  const arch = deps.arch || process.arch
  const store = deps.persist || defaultPersist()
  const notify = deps.notify || defaultNotify
  const scheduleTimeout = deps.setTimeout || setTimeout
  const scheduleInterval = deps.setInterval || setInterval
  const listeners = new Set()

  const loaded = store.load() || {}
  let lastNotified = numeric(loaded.notifiedUpdateVersion)
  let checkedAt = Number(loaded.updateCheckedAt) || null
  let backgroundStarted = false

  let state = { status: IDLE, version: null, current: getVersion(), error: null, checkedAt }
  let wired = false
  let checking = null
  let downloadLock = null

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
    state = { ...state, current: getVersion(), checkedAt, ...next }
    emit()
  }

  const markChecked = () => {
    checkedAt = Date.now()
    try {
      store.save({ updateCheckedAt: checkedAt })
    } catch {
      // last-checked is display-only
    }
    setState({ checkedAt })
  }

  const readyTitle = (version) => {
    const v = numeric(version)
    return v ? `Aftertrace v${v} is ready` : "Aftertrace is ready"
  }

  const notifyReady = (version) => {
    const v = numeric(version)
    if (!v || lastNotified === v) return false
    lastNotified = v
    try {
      store.save({ notifiedUpdateVersion: v })
    } catch {
      // persist is best-effort; the in-app control still shows
    }
    try {
      notify({
        title: readyTitle(v),
        onClick: () => {
          if (typeof deps.onNotifyClick === "function") deps.onNotifyClick()
        },
      })
    } catch {
      // a missing Notification API must not turn a finished download into an error
    }
    return true
  }

  const wire = () => {
    if (wired) return
    wired = true
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    // Default off: quit after a download installs but does not reopen.
    // Restart to update sets this true in requestInstall.
    autoUpdater.autoRunAppAfterInstall = false
    autoUpdater.allowDowngrade = false
    autoUpdater.allowPrerelease = false
    const localFeed = Object.prototype.hasOwnProperty.call(deps, "feedUrl")
      ? localGenericFeedUrl(deps.feedUrl)
      : localGenericFeedUrl()
    if (localFeed && typeof autoUpdater.setFeedURL === "function") {
      autoUpdater.setFeedURL({ provider: "generic", url: localFeed })
    }
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
      try {
        const version = (info && info.version) || state.version
        setState({ status: READY, version, error: null })
        notifyReady(version)
      } catch {
        // electron-updater must not see a throw from our listener
      }
    })
  }

  function getState() {
    return { ...state, checkedAt }
  }

  function subscribe(fn) {
    listeners.add(fn)
    fn(getState())
    return () => listeners.delete(fn)
  }

  async function download(version) {
    if (state.status === READY) return getState()
    if (downloadLock) return downloadLock
    const latest = version || state.version
    setState({ status: DOWNLOADING, version: latest, error: null })
    downloadLock = (async () => {
      try {
        await autoUpdater.downloadUpdate()
        setState({ status: READY, version: latest, error: null })
        notifyReady(latest)
        return getState()
      } catch (err) {
        const message = err && err.message ? String(err.message) : "download failed"
        setState({ status: ERROR, error: message, version: latest })
        return getState()
      } finally {
        downloadLock = null
      }
    })()
    return downloadLock
  }

  async function inspect({ interactive = false } = {}) {
    setState({ status: CHECKING, error: null })
    try {
      const result = await autoUpdater.checkForUpdates()
      const info = result && result.updateInfo
      const latest = info && info.version
      const current = getVersion()
      markChecked()
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
      return download(latest)
    } catch (err) {
      markChecked()
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

  async function check({ interactive = false } = {}) {
    wire()
    if (state.status === DOWNLOADING || downloadLock) {
      if (interactive) {
        await showDialog.showMessageBox({
          type: "info",
          message: "Downloading update",
          detail: state.version ? `Aftertrace ${state.version} is downloading. The app stays open.` : "The download is in progress.",
        })
      }
      return downloadLock || getState()
    }
    if (state.status === READY) {
      if (interactive) {
        const { response } = await showDialog.showMessageBox({
          type: "info",
          message: readyTitle(state.version),
          detail: `You have ${getVersion()}. Restart when you want the new build. Work is not interrupted until then.`,
          buttons: ["Restart to update", "Later"],
          defaultId: 0,
          cancelId: 1,
        })
        if (response === 0) return { ...getState(), restart: true }
      }
      return getState()
    }
    if (state.status === AVAILABLE && state.version) {
      return download(state.version)
    }
    return inspect({ interactive })
  }

  function checkSerialized(opts = {}) {
    const interactive = Boolean(opts.interactive)
    const start = () => {
      const p = check({ interactive }).finally(() => {
        if (checking === p) checking = null
      })
      checking = p
      return p
    }
    if (checking) {
      // A Check click during an in-flight download must not inherit the
      // silent background promise (no dialog) and must not start a second zip.
      if (state.status === DOWNLOADING || downloadLock) return check({ interactive })
      return checking.then(start, start)
    }
    return start()
  }

  function startBackgroundChecks() {
    wire()
    if (backgroundStarted) return
    backgroundStarted = true
    const run = () => checkSerialized({ interactive: false }).catch(() => {})
    const launch = scheduleTimeout(run, LAUNCH_DELAY_MS)
    if (launch && typeof launch.unref === "function") launch.unref()
    const hourly = scheduleInterval(run, HOUR_MS)
    if (hourly && typeof hourly.unref === "function") hourly.unref()
    const pm = deps.powerMonitor
    if (pm && typeof pm.on === "function") {
      pm.on("resume", run)
      pm.on("unlock-screen", run)
    }
    const netApi = deps.net
    if (netApi && typeof netApi.isOnline === "function") {
      let online = Boolean(netApi.isOnline())
      const poll = scheduleInterval(() => {
        const now = Boolean(netApi.isOnline())
        if (now && !online) run()
        online = now
      }, ONLINE_POLL_MS)
      if (poll && typeof poll.unref === "function") poll.unref()
    }
  }

  function requestInstall({ relaunch = true } = {}) {
    wire()
    if (state.status !== READY) return false
    // MacUpdater.quitAndInstall() ignores isForceRunAfter. It only relaunches
    // when autoRunAppAfterInstall is true; otherwise it calls app.quit() and
    // Squirrel.Mac replaces the bundle with no new process. Restart must flip
    // the flag. Plain quit leaves it false so autoInstallOnAppQuit installs
    // without opening the app again.
    autoUpdater.autoRunAppAfterInstall = Boolean(relaunch)
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

function getUpdater(deps) {
  if (!singleton) singleton = createUpdater(deps || {})
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
  localGenericFeedUrl,
  LAUNCH_DELAY_MS,
  HOUR_MS,
  ONLINE_POLL_MS,
  IDLE,
  CHECKING,
  AVAILABLE,
  DOWNLOADING,
  READY,
  ERROR,
  CURRENT,
}
