"use strict"

const path = require("path")

const WIDTH = 320
const HEIGHT = 400
const TRAY_BLUR_GRACE_MS = 400

function clampOnWorkArea(value, start, size, extent, pad = 8) {
  const min = start + pad
  const max = start + size - extent - pad
  return Math.round(Math.min(Math.max(value, min), Math.max(min, max)))
}

function placeNearTray(trayBounds, { display, width = WIDTH, height = HEIGHT } = {}) {
  const work = (display && display.workArea) || { x: 0, y: 0, width: 1440, height: 900 }
  const tb = trayBounds || { x: work.x + work.width - 80, y: work.y, width: 22, height: 22 }
  let x = tb.x + tb.width / 2 - width / 2
  let y = tb.y + tb.height + 6
  if (tb.y > work.y + 80) y = tb.y - height - 6
  x = clampOnWorkArea(x, work.x, work.width, width)
  y = clampOnWorkArea(y, work.y, work.height, height)
  return { x, y, width, height }
}

function shouldHideOnBlur(ignoreBlurUntil, t = Date.now()) {
  return t >= ignoreBlurUntil
}

function createPopover({ tray } = {}) {
  const { BrowserWindow, screen } = require("electron")
  const { attachGuards } = require("./window")
  let win = null
  let ignoreBlurUntil = 0

  const boundsFor = () => {
    const tb = tray && typeof tray.getBounds === "function" ? tray.getBounds() : null
    const pt = tb ? { x: tb.x, y: tb.y } : screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(pt)
    return placeNearTray(tb, { display })
  }

  const markTrayInteraction = (ms = TRAY_BLUR_GRACE_MS) => {
    const grace = Number(ms)
    ignoreBlurUntil = Date.now() + (Number.isFinite(grace) && grace > 0 ? grace : TRAY_BLUR_GRACE_MS)
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
        navigateOnDragDrop: false,
      },
    })
    attachGuards(win, { fallbackWaiting: false })
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.setMenuBarVisibility(false)
    win.on("blur", () => {
      if (!shouldHideOnBlur(ignoreBlurUntil)) return
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

  const toggleFromTray = () => {
    markTrayInteraction()
    toggle()
  }

  const send = (channel, payload) => {
    if (!win || win.isDestroyed()) return
    win.webContents.send(channel, payload)
  }

  const isOpen = () => Boolean(win && !win.isDestroyed() && win.isVisible())

  const getBounds = () => {
    if (!win || win.isDestroyed() || !win.isVisible()) return null
    return win.getBounds()
  }

  return { show, hide, toggle, toggleFromTray, send, isOpen, getBounds, placeNearTray, markTrayInteraction }
}

module.exports = {
  createPopover,
  placeNearTray,
  shouldHideOnBlur,
  clampOnWorkArea,
  WIDTH,
  HEIGHT,
  TRAY_BLUR_GRACE_MS,
}
