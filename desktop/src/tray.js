"use strict"

const fs = require("fs")
const path = require("path")
const { Tray, Menu, nativeImage, nativeTheme } = require("electron")
const { formatGlance, formatTitle, readGlance, freshnessLabel, markStale, sayUsd } = require("./glance")
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

function presentGlance(data, update, now = Date.now()) {
  const g = markStale(data, now)
  const todayLabel =
    g.ok && typeof g.todayCost === "number" && g.todayCost > 0 ? sayUsd(g.todayCost) : ""
  return {
    ...g,
    todayLabel,
    freshness: freshnessLabel(g, now),
    title: formatTitle(g),
    glance: formatGlance(g),
    update: update || null,
  }
}

function linuxMenu({ glance, extra = {}, openAtLogin, onOpen, onToggleLogin, onCheckUpdates, onRestart, onQuit, update }) {
  const items = [{ label: glance || "Open Aftertrace", enabled: false }]
  if (extra.runningTitle) items.push({ label: extra.runningTitle, enabled: false })
  if (extra.topFinding) items.push({ type: "separator" }, { label: extra.topFinding, enabled: false })
  items.push(
    { type: "separator" },
    { label: "Open Aftertrace", accelerator: "CommandOrControl+O", click: onOpen },
    { label: "Start at login", type: "checkbox", checked: Boolean(openAtLogin), click: onToggleLogin },
  )
  if (update && update.status === "ready") {
    items.push({ label: update.version ? `Restart to update · ${update.version}` : "Restart to update", click: onRestart })
  } else {
    items.push({ label: "Check for updates", click: onCheckUpdates })
  }
  items.push({ type: "separator" }, { label: "Quit Aftertrace", click: onQuit })
  return Menu.buildFromTemplate(items)
}

function createTray(handlers) {
  const tray = new Tray(trayImage())
  tray.setToolTip("Aftertrace")
  const popover = process.platform === "linux" ? null : createPopover({ tray })
  let glanceData = { ok: false, sessions: [] }
  let timer = null

  const applyIcon = () => {
    tray.setImage(trayImage())
  }
  nativeTheme.on("updated", applyIcon)

  const payload = () => presentGlance(glanceData, handlers.getUpdate && handlers.getUpdate())

  const applyTitle = (data) => {
    const title = formatTitle(data)
    if (process.platform === "darwin" && typeof tray.setTitle === "function") {
      tray.setTitle(title)
    }
    const glance = formatGlance(data)
    tray.setToolTip(title ? `Aftertrace · ${title}` : glance === "Open Aftertrace" ? "Aftertrace" : `Aftertrace · ${glance}`)
  }

  const refresh = async () => {
    glanceData = await readGlance(UI_ORIGIN)
    const view = payload()
    applyTitle(view)
    if (popover) popover.send("desktop:glance", view)
    if (process.platform === "linux") {
      const menu = linuxMenu({
        glance: view.glance,
        extra: {
          runningTitle: view.title,
          topFinding: view.topFinding,
        },
        openAtLogin: handlers.isOpenAtLogin(),
        onOpen: handlers.onOpen,
        onToggleLogin: handlers.onToggleLogin,
        onCheckUpdates: handlers.onCheckUpdates,
        onRestart: handlers.onRestart,
        onQuit: handlers.onQuit,
        update: view.update,
      })
      tray.setContextMenu(menu)
    }
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

  if (process.platform !== "linux") {
    tray.on("click", () => {
      if (popover) {
        // Tray click blurs the panel first. Ignore that hide so the same
        // click can close an open popover instead of hiding-then-reopening.
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
  }
}

module.exports = { createTray, trayImage, presentGlance, linuxMenu }
