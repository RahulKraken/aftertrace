"use strict"

// Capture Today, Sessions and Findings from a real Electron window at 1024
// and 1440. Serve the mock UI on :7311 in the same CI step.
const fs = require("fs")
const path = require("path")
const { app, BrowserWindow, ipcMain, nativeTheme, systemPreferences } = require("electron")
const { dashboardWindowOptions, attachGuards } = require("../src/window")

const OUT = process.env.SHOT_OUT || path.join(__dirname, "../dist/ui-shots")
const ORIGIN = process.env.SHOT_ORIGIN || "http://127.0.0.1:7311"
const IDLE = { status: "idle", version: null, current: "0.5.7", error: null }
const SIZES = [
  { w: 1024, h: 720, tag: "1024" },
  { w: 1440, h: 900, tag: "1440" },
]
const PAGES = [
  { hash: "/", name: "today-electron", ready: "!!document.querySelector('.hero .big')" },
  { hash: "/sessions", name: "sessions-electron", ready: "!!document.querySelector('.tbl.sess')" },
  { hash: "/findings", name: "findings-electron", ready: "!!document.querySelector('.fr')" },
]

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function stubIpc() {
  ipcMain.handle("desktop:getUpdate", () => IDLE)
  ipcMain.handle("desktop:checkUpdates", () => IDLE)
  ipcMain.handle("desktop:engineStatus", () => ({ state: "idle" }))
  ipcMain.handle("desktop:getOpenAtLogin", () => false)
  ipcMain.handle("desktop:setOpenAtLogin", () => false)
  ipcMain.handle("desktop:openSettings", () => true)
  ipcMain.handle("desktop:openDashboard", () => true)
  ipcMain.handle("desktop:getAccentColor", () => {
    try {
      return systemPreferences.getAccentColor()
    } catch {
      return "007aff"
    }
  })
}

async function exec(win, js, ms = 2500) {
  return Promise.race([
    win.webContents.executeJavaScript(js),
    sleep(ms).then(() => {
      throw new Error(`exec timeout: ${js}`)
    }),
  ])
}

async function waitFor(win, js, timeout = 20000) {
  const start = Date.now()
  let last = ""
  while (Date.now() - start < timeout) {
    try {
      last = String(await exec(win, js))
      if (last && last !== "false" && last !== "0" && last !== "null") return
    } catch (err) {
      last = err instanceof Error ? err.message : String(err)
    }
    await sleep(250)
  }
  throw new Error(`timeout waiting for ${js} (last=${last} url=${win.webContents.getURL()})`)
}

async function shot(win, page, theme, tag) {
  nativeTheme.themeSource = theme
  const url = `${ORIGIN}/index.html`
  console.log(`navigate ${url} hash=${page.hash} theme=${theme} ${tag}`)
  win.loadURL(url).then(
    () => console.log("loadURL resolved", url),
    (err) => console.warn("loadURL rejected", url, err),
  )
  await waitFor(win, "!!document.querySelector('#root')")
  await exec(
    win,
    `localStorage.setItem("aftertrace-theme", ${JSON.stringify(theme)});
     localStorage.removeItem("aftertrace-resolved");
     document.documentElement.dataset.theme = ${JSON.stringify(theme)};
     if (location.hash !== ${JSON.stringify("#" + page.hash)}) location.hash = ${JSON.stringify("#" + page.hash)};
     true`,
  )
  await waitFor(
    win,
    `document.documentElement.dataset.theme === ${JSON.stringify(theme)} && !!document.querySelector('.nav') && !document.querySelector('.skel-page') && (${page.ready})`,
  )
  await sleep(400)
  const img = await win.capturePage()
  const dest = path.join(OUT, `${page.name}-${tag}-${theme}.png`)
  fs.writeFileSync(dest, img.toPNG())
  console.log(`wrote ${dest} (${img.getSize().width}x${img.getSize().height})`)
}

app.commandLine.appendSwitch("disable-http-cache")
setTimeout(() => {
  console.error("ci-window-shots: global timeout")
  app.exit(1)
}, 180_000).unref()

app
  .whenReady()
  .then(async () => {
    console.log("electron ready, origin", ORIGIN)
    stubIpc()
    fs.mkdirSync(OUT, { recursive: true })
    const opts = dashboardWindowOptions()
    const win = new BrowserWindow({
      ...opts,
      show: true,
      paintWhenInitiallyHidden: true,
    })
    win.setPosition(40, 40)
    attachGuards(win, { fallbackWaiting: false })
    win.webContents.on("console-message", (_e, _l, msg) => console.log("renderer:", msg))
    win.webContents.on("did-finish-load", () => console.log("did-finish-load", win.webContents.getURL()))
    win.webContents.on("dom-ready", () => console.log("dom-ready", win.webContents.getURL()))
    win.webContents.on("did-fail-load", (_e, code, desc, failedUrl, isMain) => {
      console.warn("did-fail-load", { code, desc, failedUrl, isMain })
    })
    for (const size of SIZES) {
      win.setContentSize(size.w, size.h)
      await sleep(150)
      console.log("content size", win.getContentSize(), "requested", size.w, size.h)
      for (const page of PAGES) {
        await shot(win, page, "light", size.tag)
      }
    }
    app.exit(0)
  })
  .catch((err) => {
    console.error(err)
    app.exit(1)
  })
