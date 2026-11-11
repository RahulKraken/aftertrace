"use strict"

// Capture Today and Sessions from a real Electron window (hiddenInset traffic
// lights, sidebar vibrancy). Serve the mock UI on :7311 in the same CI step.
const fs = require("fs")
const path = require("path")
const { app, BrowserWindow, nativeTheme } = require("electron")
const { dashboardWindowOptions, attachGuards } = require("../src/window")

const OUT = process.env.SHOT_OUT || path.join(__dirname, "../dist/ui-shots")
const ORIGIN = process.env.SHOT_ORIGIN || "http://127.0.0.1:7311"

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function load(win, url) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`load timeout ${url}`)), 20000)
    const ok = () => {
      clearTimeout(t)
      win.webContents.removeListener("did-fail-load", fail)
      resolve()
    }
    const fail = (_e, code, desc, failedUrl, isMain) => {
      if (!isMain) return
      clearTimeout(t)
      win.webContents.removeListener("did-finish-load", ok)
      reject(new Error(`did-fail-load ${code} ${desc} ${failedUrl}`))
    }
    win.webContents.once("did-finish-load", ok)
    win.webContents.once("did-fail-load", fail)
    win.loadURL(url).catch((err) => {
      clearTimeout(t)
      reject(err)
    })
  })
}

async function waitFor(win, js, timeout = 20000) {
  const start = Date.now()
  let last = ""
  while (Date.now() - start < timeout) {
    try {
      last = String(await win.webContents.executeJavaScript(js))
      if (last && last !== "false" && last !== "0" && last !== "null") return
    } catch (err) {
      last = err instanceof Error ? err.message : String(err)
    }
    await sleep(250)
  }
  throw new Error(`timeout waiting for ${js} (last=${last})`)
}

async function shot(win, hash, theme, name) {
  nativeTheme.themeSource = theme
  console.log(`loading ${ORIGIN}/#${hash} theme=${theme}`)
  await load(win, `${ORIGIN}/#${hash}`)
  await waitFor(win, "!!document.querySelector('.nav') && !document.querySelector('.skel-page')")
  await win.webContents.executeJavaScript(`
    localStorage.setItem("aftertrace-theme", ${JSON.stringify(theme)});
    localStorage.removeItem("aftertrace-resolved");
    document.documentElement.dataset.theme = ${JSON.stringify(theme)};
  `)
  await load(win, `${ORIGIN}/#${hash}`)
  await waitFor(win, `document.documentElement.dataset.theme === ${JSON.stringify(theme)} && !!document.querySelector('.nav')`)
  await sleep(400)
  const img = await win.capturePage()
  const dest = path.join(OUT, `${name}-${theme}.png`)
  fs.writeFileSync(dest, img.toPNG())
  console.log(`wrote ${dest} (${img.getSize().width}x${img.getSize().height})`)
}

app.commandLine.appendSwitch("disable-http-cache")
app.commandLine.appendSwitch("disable-gpu")
app.commandLine.appendSwitch("disable-software-rasterizer")
setTimeout(() => {
  console.error("ci-window-shots: global timeout")
  app.exit(1)
}, 90_000).unref()

app
  .whenReady()
  .then(async () => {
    console.log("electron ready, origin", ORIGIN)
    fs.mkdirSync(OUT, { recursive: true })
    const opts = dashboardWindowOptions()
    const win = new BrowserWindow({
      ...opts,
      show: false,
      paintWhenInitiallyHidden: true,
    })
    attachGuards(win, { fallbackWaiting: false })
    win.webContents.on("console-message", (_e, _l, msg) => console.log("renderer:", msg))
    for (const theme of ["light", "dark"]) {
      await shot(win, "/", theme, "today-electron")
      await shot(win, "/sessions", theme, "sessions-electron")
    }
    app.exit(0)
  })
  .catch((err) => {
    console.error(err)
    app.exit(1)
  })
