"use strict"

const path = require("path")
const { BrowserWindow, screen } = require("electron")

const WIDTH = 320
const HEIGHT = 400

function placeNearTray(trayBounds, { display, width = WIDTH, height = HEIGHT } = {}) {
  const work = (display && display.workArea) || { x: 0, y: 0, width: 1440, height: 900 }
  const tb = trayBounds || { x: work.x + work.width - 80, y: work.y, width: 22, height: 22 }
  let x = Math.round(tb.x + tb.width / 2 - width / 2)
  let y = Math.round(tb.y + tb.height + 6)
  if (tb.y > work.y + 80) y = Math.round(tb.y - height - 6)
  x = Math.min(Math.max(x, work.x + 8), work.x + work.width - width - 8)
  y = Math.min(Math.max(y, work.y + 8), work.y + work.height - height - 8)
  return { x, y, width, height }
}

function createPopover({ tray } = {}) {
  let win = null

  const boundsFor = () => {
    const tb = tray && typeof tray.getBounds === "function" ? tray.getBounds() : null
    const pt = tb ? { x: tb.x, y: tb.y } : screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(pt)
    return placeNearTray(tb, { display })
  }

  const ensure = () => {
    if (win && !win.isDestroyed()) return win
    win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: true,
      type: process.platform === "darwin" ? "panel" : "toolbar",
      backgroundColor: "#fffefb",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
      },
    })
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.setMenuBarVisibility(false)
    win.on("blur", () => {
      if (win && !win.isDestroyed()) win.hide()
    })
    win.on("closed", () => {
      win = null
    })
    win.loadFile(path.join(__dirname, "../renderer/popover.html")).catch(() => {})
    return win
  }

  const show = () => {
    const w = ensure()
    const b = boundsFor()
    w.setBounds(b, false)
    w.show()
    w.focus()
  }

  const hide = () => {
    if (win && !win.isDestroyed()) win.hide()
  }

  const toggle = () => {
    if (win && !win.isDestroyed() && win.isVisible()) hide()
    else show()
  }

  const send = (channel, payload) => {
    if (!win || win.isDestroyed()) return
    win.webContents.send(channel, payload)
  }

  const isOpen = () => Boolean(win && !win.isDestroyed() && win.isVisible())

  return { show, hide, toggle, send, isOpen, placeNearTray }
}

module.exports = { createPopover, placeNearTray, WIDTH, HEIGHT }
