"use strict"

// Capture Today and Sessions from a real Electron window (hiddenInset traffic
// lights, sidebar vibrancy). Serve the mock UI on :7311 first — this script
// does not start the Go engine.
const fs = require("fs")
const path = require("path")
const { app, BrowserWindow, nativeTheme } = require("electron")
const { dashboardWindowOptions, attachGuards } = require("../src/window")

const OUT = process.env.SHOT_OUT || path.join(__dirname, "../dist/ui-shots")
const ORIGIN = process.env.SHOT_ORIGIN || "http://127.0.0.1:7311"

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
  await win.webContents.executeJavaScript(`
    localStorage.setItem("aftertrace-theme", ${JSON.stringify(theme)});
    localStorage.removeItem("aftertrace-resolved");
  `).catch(() => {})
  await win.loadURL(`${ORIGIN}/#${hash}`)
  await waitFor(win, "!!document.querySelector('.nav') && !document.querySelector('.skel-page')")
  await win.webContents.executeJavaScript(`
    document.documentElement.dataset.theme = ${JSON.stringify(theme)};
    localStorage.setItem("aftertrace-theme", ${JSON.stringify(theme)});
  `)
  await sleep(600)
  const img = await win.capturePage()
  const dest = path.join(OUT, `${name}-${theme}.png`)
  fs.writeFileSync(dest, img.toPNG())
  console.log(`wrote ${dest} (${img.getSize().width}x${img.getSize().height})`)
}

app.commandLine.appendSwitch("disable-http-cache")
setTimeout(() => {
  console.error("ci-window-shots: global timeout")
  app.exit(1)
}, 90_000).unref()

app
  .whenReady()
  .then(async () => {
    fs.mkdirSync(OUT, { recursive: true })
    const win = new BrowserWindow({
      ...dashboardWindowOptions(),
      show: true,
      x: 40,
      y: 40,
    })
    attachGuards(win, { fallbackWaiting: false })
    win.show()
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
