"use strict"

const fs = require("fs")
const path = require("path")
const { BrowserWindow, nativeTheme } = require("electron")
const { isAllowedUrl, UI_ORIGIN } = require("./allowlist")

function windowIcon() {
  const extra = path.join(process.resourcesPath || "", "icons", "icon.png")
  if (extra && fs.existsSync(extra)) return extra
  return path.join(__dirname, "../resources/icons/icon.png")
}

function background() {
  return nativeTheme.shouldUseDarkColors ? "#1e1e20" : "#ffffff"
}

function isMac() {
  return process.platform === "darwin"
}

function dashboardWindowOptions() {
  const mac = isMac()
  return {
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 560,
    show: false,
    title: "Aftertrace",
    icon: windowIcon(),
    backgroundColor: mac ? "#00000000" : background(),
    autoHideMenuBar: true,
    ...(mac
      ? {
          titleBarStyle: "hiddenInset",
          trafficLightPosition: { x: 20, y: 18 },
          vibrancy: "sidebar",
          visualEffectState: "active",
          transparent: true,
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      additionalArguments: ["--aftertrace-window=dashboard"],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      navigateOnDragDrop: false,
    },
  }
}

function settingsWindowOptions() {
  const mac = isMac()
  return {
    width: 720,
    height: 640,
    minWidth: 560,
    minHeight: 420,
    show: false,
    title: "Settings",
    icon: windowIcon(),
    backgroundColor: background(),
    autoHideMenuBar: true,
    ...(mac
      ? {
          titleBarStyle: "hiddenInset",
          trafficLightPosition: { x: 20, y: 18 },
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      additionalArguments: ["--aftertrace-window=settings"],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      navigateOnDragDrop: false,
    },
  }
}

function attachGuards(win, { fallbackWaiting = true } = {}) {
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  const block = (e, url) => {
    if (!isAllowedUrl(url)) e.preventDefault()
  }
  win.webContents.on("will-navigate", block)
  win.webContents.on("will-redirect", block)
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  win.webContents.session.setPermissionCheckHandler(() => false)
  if (!fallbackWaiting) return
  win.webContents.on("did-fail-load", (_e, code, _desc, url, isMain) => {
    if (!isMain || code === 0) return
    if (url && url.startsWith(UI_ORIGIN)) {
      win.loadFile(path.join(__dirname, "../renderer/waiting.html")).catch(() => {})
    }
  })
}

function createWindow() {
  const win = new BrowserWindow(dashboardWindowOptions())
  attachGuards(win)
  win.once("ready-to-show", () => win.show())
  return win
}

function createSettingsWindow() {
  const win = new BrowserWindow(settingsWindowOptions())
  attachGuards(win)
  win.once("ready-to-show", () => win.show())
  return win
}

module.exports = {
  createWindow,
  createSettingsWindow,
  attachGuards,
  background,
  dashboardWindowOptions,
  settingsWindowOptions,
}
