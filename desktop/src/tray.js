"use strict"

const fs = require("fs")
const path = require("path")
const { Tray, Menu, nativeImage, nativeTheme } = require("electron")
const { formatGlance, formatTitle, readGlance, freshnessLabel, markStale, sayUsd } = require("./glance")
const {
  menuTemplate,
  menuLabels,
  setMenuVariant: applyMenuVariant,
  getMenuVariant,
  supportsSublabel,
  osVersion,
} = require("./sessionMenu")
const { createPopover } = require("./popover")
const { UI_ORIGIN } = require("./allowlist")

const OPEN_MS = 12_000
const IDLE_MS = 45_000

function unpack(p) {
  return p.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
}

function iconPath(name) {
  const candidates = [
    path.join(process.resourcesPath || "", "icons", name),
    path.join(__dirname, "../resources/icons", name),
  ]
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p
    const u = unpack(p)
    if (u !== p && fs.existsSync(u)) return u
  }
  return candidates[candidates.length - 1]
}

function loadPng(name) {
  const p = iconPath(name)
  const img = nativeImage.createFromPath(p)
  const retinaName = name.replace(/\.png$/, "@2x.png")
  if (retinaName !== name) {
    const retina = iconPath(retinaName)
    if (retina && fs.existsSync(retina) && retina !== p) {
      img.addRepresentation({ scaleFactor: 2, path: retina })
    }
  }
  return img
}

function trayImage() {
  if (process.platform === "darwin") {
    const img = loadPng("trayTemplate.png")
    img.setTemplateImage(true)
    return img
  }
  if (process.platform === "linux") {
    return loadPng("tray-22-light.png")
  }
  const dark = Boolean(nativeTheme.shouldUseDarkColors)
  return loadPng(dark ? "tray-16-light.png" : "tray-16.png")
}

function usesNativeMenu(platform = process.platform) {
  return platform === "darwin" || platform === "linux"
}

function presentGlance(data, update, now = Date.now()) {
  const g = markStale(data, now)
  const todayLabel =
    g.ok && typeof g.todayCost === "number" && g.todayCost > 0 ? sayUsd(g.todayCost) : ""
  const view = {
    ...g,
    todayLabel,
    freshness: freshnessLabel(g, now),
    title: formatTitle(g),
    glance: formatGlance(g),
    update: update || null,
  }
  view.menuLabels = menuLabels(view)
  return view
}

function nativeMenu(view, handlers = {}) {
  return Menu.buildFromTemplate(
    menuTemplate(view, {
      openAtLogin: typeof handlers.isOpenAtLogin === "function" ? handlers.isOpenAtLogin() : handlers.openAtLogin,
      onOpen: handlers.onOpen,
      onOpenSession: handlers.onOpenSession,
      onToggleLogin: handlers.onToggleLogin,
      onCheckUpdates: handlers.onCheckUpdates,
      onRestart: handlers.onRestart,
      onQuit: handlers.onQuit,
    }),
  )
}

function createTray(handlers) {
  const tray = new Tray(trayImage())
  tray.setToolTip("Aftertrace")
  const native = usesNativeMenu()
  const popover = native ? null : createPopover({ tray })
  let glanceData = { ok: false, sessions: [] }
  let timer = null
  let lastLabels = []

  const applyIcon = () => {
    tray.setImage(trayImage())
  }
  nativeTheme.on("updated", applyIcon)

  const payload = () => presentGlance(glanceData, handlers.getUpdate && handlers.getUpdate())

  const applyTitle = () => {
    // Icon-only extra on Mac. Changing setTitle text shifts neighboring extras.
    if (process.platform === "darwin" && typeof tray.setTitle === "function") {
      tray.setTitle("")
    }
    tray.setToolTip("Aftertrace")
  }

  const buildMenu = (view) =>
    nativeMenu(view, {
      isOpenAtLogin: handlers.isOpenAtLogin,
      onOpen: handlers.onOpen,
      onOpenSession: handlers.onOpenSession,
      onToggleLogin: handlers.onToggleLogin,
      onCheckUpdates: handlers.onCheckUpdates,
      onRestart: handlers.onRestart,
      onQuit: handlers.onQuit,
    })

  const applyNativeMenu = (view) => {
    lastLabels = view.menuLabels || menuLabels(view)
    if (!native) return
    tray.setContextMenu(buildMenu(view))
  }

  const refresh = async () => {
    glanceData = await readGlance(UI_ORIGIN)
    const view = payload()
    applyTitle()
    applyNativeMenu(view)
    if (popover) popover.send("desktop:glance", view)
    schedule()
    return view
  }

  const schedule = () => {
    if (timer) clearInterval(timer)
    const ms = popover && popover.isOpen() ? OPEN_MS : IDLE_MS
    timer = setInterval(() => {
      refresh().catch(() => {})
    }, ms)
    timer.unref?.()
  }

  const showNativeMenu = () => {
    const view = payload()
    lastLabels = view.menuLabels || menuLabels(view)
    applyNativeMenu(view)
    // Rebuilds on each open. An already-open NSMenu is not mutated in place.
    // Position is Windows-only; passing it on Darwin can no-op the popup.
    if (typeof tray.popUpContextMenu === "function") {
      tray.popUpContextMenu(buildMenu(view))
    }
  }

  if (!native) {
    tray.on("click", () => {
      if (popover) {
        popover.toggleFromTray()
        refresh().then((view) => popover.send("desktop:glance", view)).catch(() => {})
        schedule()
      } else {
        handlers.onOpen()
      }
    })
    tray.on("right-click", () => {
      if (popover) popover.toggleFromTray()
    })
  }

  refresh().catch(() => {})
  schedule()

  return {
    tray,
    refresh,
    popover,
    presentGlance,
    showNativeMenu,
    menuLabels: () => lastLabels,
    setMenuVariant: (v) => {
      applyMenuVariant(v)
      const view = payload()
      applyNativeMenu(view)
      return getMenuVariant()
    },
    menuMeta: () => ({
      menuVariant: getMenuVariant(),
      menuSublabelSupported: supportsSublabel(),
      osVersion: osVersion(),
    }),
  }
}

module.exports = {
  createTray,
  trayImage,
  presentGlance,
  nativeMenu,
  usesNativeMenu,
  linuxMenu: nativeMenu,
}
