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
  return nativeTheme.shouldUseDarkColors ? "#141312" : "#f6f5f1"
}

function attachGuards(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  const block = (e, url) => {
    if (!isAllowedUrl(url)) e.preventDefault()
  }
  win.webContents.on("will-navigate", block)
  win.webContents.on("will-redirect", block)
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  win.webContents.session.setPermissionCheckHandler(() => false)
  win.webContents.on("did-fail-load", (_e, code, _desc, url, isMain) => {
    if (!isMain || code === 0) return
    if (url && url.startsWith(UI_ORIGIN)) {
      win.loadFile(path.join(__dirname, "../renderer/waiting.html")).catch(() => {})
    }
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 880,
    minHeight: 560,
    show: false,
    title: "Aftertrace",
    icon: windowIcon(),
    backgroundColor: background(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      navigateOnDragDrop: false,
    },
  })
  attachGuards(win)
  win.once("ready-to-show", () => win.show())
  return win
}

module.exports = { createWindow, attachGuards, background }
