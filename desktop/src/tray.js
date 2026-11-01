"use strict"

const fs = require("fs")
const path = require("path")
const { Tray, Menu, nativeImage, nativeTheme } = require("electron")
const { formatGlance, readGlance } = require("./glance")
const { UI_ORIGIN } = require("./allowlist")

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
  // Template images do not exist off macOS. Linux status trays are almost
  // always dark (GNOME/KDE/XFCE), and nativeTheme often follows the GTK
  // window theme rather than the panel, so always use the cream 22px glyph.
  // Windows taskbars follow the app color scheme.
  if (process.platform === "linux") {
    return loadPng("tray-22-light.png")
  }
  const dark = Boolean(nativeTheme.shouldUseDarkColors)
  return loadPng(dark ? "tray-16-light.png" : "tray-16.png")
}

function buildMenu({ glance, extra = {}, openAtLogin, onOpen, onToggleLogin, onCheckUpdates, onQuit }) {
  const items = [{ label: glance || "Open Aftertrace", enabled: false }]
  if (extra.runningTitle) {
    items.push({ label: extra.runningTitle, enabled: false })
  }
  if (extra.topFinding) {
    items.push({ type: "separator" }, { label: extra.topFinding, enabled: false })
  }
  items.push(
    { type: "separator" },
    { label: "Open Aftertrace", accelerator: "CommandOrControl+O", click: onOpen },
    { label: "Start at login", type: "checkbox", checked: Boolean(openAtLogin), click: onToggleLogin },
    { label: "Check for updates", click: onCheckUpdates },
    { type: "separator" },
    { label: "Quit Aftertrace", click: onQuit },
  )
  return Menu.buildFromTemplate(items)
}

function createTray(handlers) {
  const tray = new Tray(trayImage())
  tray.setToolTip("Aftertrace")
  let glance = "Open Aftertrace"

  const applyIcon = () => {
    tray.setImage(trayImage())
  }
  nativeTheme.on("updated", applyIcon)

  const refresh = async () => {
    const data = await readGlance(UI_ORIGIN)
    glance = formatGlance(data)
    const menu = buildMenu({
      glance,
      extra: { runningTitle: data.runningTitle, topFinding: data.topFinding },
      openAtLogin: handlers.isOpenAtLogin(),
      onOpen: handlers.onOpen,
      onToggleLogin: handlers.onToggleLogin,
      onCheckUpdates: handlers.onCheckUpdates,
      onQuit: handlers.onQuit,
    })
    tray.setContextMenu(menu)
    tray.setToolTip(glance === "Open Aftertrace" ? "Aftertrace" : `Aftertrace · ${glance}`)
    return menu
  }

  // Linux tray click events are unreliable; the context menu is the path.
  if (process.platform !== "linux") {
    tray.on("click", () => {
      if (process.platform === "darwin") {
        refresh().then((menu) => tray.popUpContextMenu(menu))
      } else {
        handlers.onOpen()
      }
    })
    tray.on("right-click", () => {
      refresh().then((menu) => tray.popUpContextMenu(menu))
    })
  }

  refresh()
  const timer = setInterval(refresh, 60_000)
  timer.unref?.()

  return { tray, refresh }
}

module.exports = { createTray, buildMenu, trayImage }
