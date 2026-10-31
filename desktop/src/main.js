"use strict"

const path = require("path")
const { app, ipcMain, Menu } = require("electron")
const { createEngine } = require("./engine")
const { enginePath } = require("./paths")
const { createWindow } = require("./window")
const { createTray } = require("./tray")
const autostart = require("./autostart")
const settings = require("./settings")
const { checkForUpdates, startBackgroundChecks } = require("./updater")
const { UI_ORIGIN } = require("./allowlist")

// Menu-bar extra: no dock bounce, no second icon next to the window.
if (process.platform === "darwin" && app.dock) {
  app.dock.hide()
}

app.setName("Aftertrace")
if (process.platform === "win32") {
  app.setAppUserModelId("com.rahulkraken.aftertrace")
}
// Tray-first: skip the GPU process while idle. The window loads a local page.
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
}

async function loadUi(target) {
  const w = target || win
  if (!w || w.isDestroyed()) return
  await w.loadFile(path.join(__dirname, "../renderer/waiting.html"))
  const ok = await engine.waitUntilHealthy(120_000)
  if (!win || win.isDestroyed() || win !== w) return
  if (!ok) return
  await w.loadURL(UI_ORIGIN + "/")
}

async function openWindow() {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    return win
  }
  win = createWindow()
  win.on("closed", () => {
    win = null
  })
  win.on("close", () => {
    // Destroyed, not hidden, so idle memory stays at the tray + sidecar.
  })

  const first = !settings.load(userData()).firstLaunchDone
  if (first) {
    await win.loadFile(path.join(__dirname, "../renderer/first-launch.html"))
  } else {
    await loadUi(win)
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

app.on("second-instance", () => {
  openWindow()
})

app.on("window-all-closed", () => {
  // Stay in the tray. Quit is explicit.
})

app.on("before-quit", (e) => {
  if (quitting) return
  e.preventDefault()
  quitting = true
  Promise.resolve(engine && engine.stop())
    .catch(() => {})
    .finally(() => {
      destroyWindow()
      app.quit()
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

  trayApi = createTray({
    isOpenAtLogin,
    onOpen: () => openWindow(),
    onToggleLogin: () => setOpenAtLogin(!isOpenAtLogin()),
    onCheckUpdates: () => checkForUpdates({ interactive: true }),
    onQuit: () => app.quit(),
  })

  startBackgroundChecks()

  const first = !settings.load(userData()).firstLaunchDone
  if (!hiddenLaunch || first) await openWindow()
})
