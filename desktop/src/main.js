"use strict"

const path = require("path")
const { app, ipcMain, Menu } = require("electron")
const { createEngine } = require("./engine")
const { enginePath } = require("./paths")
const { createWindow } = require("./window")
const { createTray, presentGlance } = require("./tray")
const { setDashboardVisible } = require("./dock")
const autostart = require("./autostart")
const settings = require("./settings")
const { getUpdater } = require("./updater")
const { finishQuit } = require("./quit")
const { UI_ORIGIN } = require("./allowlist")

// Start as a menu extra. Dock/Cmd+Tab come back only while the dashboard is open.
if (process.platform === "darwin" && app.dock) {
  app.dock.hide()
}

app.setName("Aftertrace")
if (process.platform === "win32") {
  app.setAppUserModelId("com.rahulkraken.aftertrace")
}
app.disableHardwareAcceleration()

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
  process.exit(0)
}

const hiddenLaunch = process.argv.includes("--hidden") || Boolean(app.getLoginItemSettings && app.getLoginItemSettings().wasOpenedAtLogin)

let win = null
let trayApi = null
let engine
let quitting = false
let restartingForUpdate = false
const updater = getUpdater()

function userData() {
  return app.getPath("userData")
}

function isOpenAtLogin() {
  return autostart.isEnabled(app)
}

function setOpenAtLogin(enabled) {
  settings.save(userData(), { openAtLogin: Boolean(enabled) })
  autostart.apply({ enabled: Boolean(enabled), app })
  trayApi && trayApi.refresh()
  return Boolean(enabled)
}

function destroyWindow() {
  if (!win) return
  const w = win
  win = null
  if (!w.isDestroyed()) w.destroy()
  setDashboardVisible(false, { app })
}

function uiUrl(hash) {
  if (!hash) return `${UI_ORIGIN}/`
  const h = String(hash)
  if (h.startsWith("#")) return `${UI_ORIGIN}/${h}`
  if (h.startsWith("/")) return `${UI_ORIGIN}/#${h}`
  return `${UI_ORIGIN}/#/${h}`
}

async function loadUi(target, hash) {
  const w = target || win
  if (!w || w.isDestroyed()) return
  await w.loadFile(path.join(__dirname, "../renderer/waiting.html"))
  const ok = await engine.waitUntilHealthy(120_000)
  if (!win || win.isDestroyed() || win !== w) return
  if (!ok) return
  await w.loadURL(uiUrl(hash))
}

async function openWindow(hash) {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    setDashboardVisible(true, { app })
    win.show()
    win.focus()
    if (hash) await loadUi(win, hash)
    return win
  }
  win = createWindow()
  win.on("show", () => setDashboardVisible(true, { app }))
  win.on("closed", () => {
    win = null
    setDashboardVisible(false, { app })
  })
  win.on("close", () => {
    // Destroyed, not hidden, so idle memory stays at the tray + sidecar.
  })

  const first = !settings.load(userData()).firstLaunchDone
  if (first) {
    await win.loadFile(path.join(__dirname, "../renderer/first-launch.html"))
  } else {
    await loadUi(win, hash)
  }
  return win
}

function installMenu() {
  const isMac = process.platform === "darwin"
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    ...(isMac ? [] : [{ label: "File", submenu: [{ role: "quit" }] }]),
    { role: "editMenu" },
    { role: "windowMenu" },
    ...(!app.isPackaged
      ? [
          {
            label: "Develop",
            submenu: [{ role: "reload" }, { role: "toggleDevTools" }],
          },
        ]
      : []),
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function pushUpdate(state) {
  if (trayApi && trayApi.popover) trayApi.popover.send("desktop:update", state)
  trayApi && trayApi.refresh && trayApi.refresh().catch(() => {})
}

async function restartToUpdate() {
  const st = updater.getState()
  if (st.status !== "ready") return false
  restartingForUpdate = true
  app.quit()
  return true
}

app.on("second-instance", () => {
  openWindow()
})

app.on("window-all-closed", () => {
  setDashboardVisible(false, { app })
})

app.on("before-quit", (e) => {
  if (quitting) return
  e.preventDefault()
  quitting = true
  finishQuit({
    stopEngine: async () => {
      try {
        if (engine) await engine.stop()
      } finally {
        destroyWindow()
      }
    },
    restartingForUpdate,
    requestInstall: (opts) => updater.requestInstall(opts),
    quit: () => app.quit(),
  })
})

app.on("activate", () => {
  openWindow()
})

ipcMain.handle("desktop:getOpenAtLogin", () => isOpenAtLogin())
ipcMain.handle("desktop:setOpenAtLogin", (_e, enabled) => setOpenAtLogin(enabled))
ipcMain.handle("desktop:continue", async () => {
  settings.save(userData(), { firstLaunchDone: true })
  await loadUi()
  return true
})
ipcMain.handle("desktop:engineStatus", () => (engine ? engine.status() : { state: "idle" }))
ipcMain.handle("desktop:getGlance", async () => {
  if (trayApi && trayApi.refresh) return trayApi.refresh()
  return presentGlance({ ok: false, sessions: [] }, updater.getState())
})
ipcMain.handle("desktop:getUpdate", () => updater.getState())
ipcMain.handle("desktop:openDashboard", (_e, hash) => openWindow(hash))
ipcMain.handle("desktop:checkUpdates", async () => {
  const st = await updater.check({ interactive: true })
  if (st && st.restart) return restartToUpdate()
  pushUpdate(updater.getState())
  return updater.getState()
})
ipcMain.handle("desktop:restartToUpdate", () => restartToUpdate())
ipcMain.handle("desktop:quit", () => {
  app.quit()
  return true
})

app.whenReady().then(async () => {
  installMenu()
  app.setAboutPanelOptions({
    applicationName: "Aftertrace",
    applicationVersion: app.getVersion(),
    copyright: "Apache-2.0. Local only. No usage telemetry.",
  })

  const bin = enginePath({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  })
  engine = createEngine({ bin })
  engine.onStatus((status) => {
    if (win && !win.isDestroyed()) win.webContents.send("desktop:engine-status", status)
  })
  engine.start()

  updater.subscribe((st) => {
    if (trayApi && trayApi.popover) trayApi.popover.send("desktop:update", st)
  })

  trayApi = createTray({
    isOpenAtLogin,
    getUpdate: () => updater.getState(),
    onOpen: () => openWindow(),
    onToggleLogin: () => setOpenAtLogin(!isOpenAtLogin()),
    onCheckUpdates: () => updater.check({ interactive: true }).then((st) => {
      if (st && st.restart) return restartToUpdate()
      pushUpdate(updater.getState())
    }),
    onRestart: () => restartToUpdate(),
    onQuit: () => app.quit(),
  })

  updater.startBackgroundChecks()

  const first = !settings.load(userData()).firstLaunchDone
  if (!hiddenLaunch || first) await openWindow()
})
