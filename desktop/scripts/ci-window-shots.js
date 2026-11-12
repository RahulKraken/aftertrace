"use strict"

// Capture Today, Sessions, Findings, Spend, a long turn and Settings from a
// real Electron window at 1024 and 1440, light and dark. Also record
// selection going grey on focus loss and the Copied confirmation.
const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")
const { app, BrowserWindow, ipcMain, nativeTheme, systemPreferences } = require("electron")
const { dashboardWindowOptions, settingsWindowOptions, attachGuards } = require("../src/window")

const OUT = process.env.SHOT_OUT || path.join(__dirname, "../dist/ui-shots")
const ORIGIN = process.env.SHOT_ORIGIN || "http://127.0.0.1:7311"
const IDLE = { status: "idle", version: null, current: "0.5.7", error: null }
const READY = { status: "ready", version: "0.5.7", current: "0.5.6", error: null, checkedAt: Date.now() - 90_000 }
const SIZES = [
  { w: 1024, h: 720, tag: "1024" },
  { w: 1440, h: 900, tag: "1440" },
]
const PAINTED = "!document.querySelector('.skel-page') && !/Connecting/.test(document.body.innerText||'')"
const PAGES = [
  { hash: "/", name: "today-electron", ready: `${PAINTED} && /\\$/.test(document.querySelector('.hero .big')?.textContent||'')` },
  { hash: "/sessions", name: "sessions-electron", ready: `${PAINTED} && document.querySelectorAll('.sess td.c-title .title').length > 1 && [...document.querySelectorAll('.sess td.c-title .title')].every((el) => el.clientHeight > 8 && (el.textContent || '').trim().length > 8)` },
  { hash: "/findings", name: "findings-electron", ready: `${PAINTED} && !!document.querySelector('.fr.sel')` },
  { hash: "/spend", name: "spend-electron", ready: `${PAINTED} && (document.querySelector('.insight')?.textContent||'').length > 20 && /\\$/.test(document.querySelector('.hero .big')?.textContent||'')` },
  { hash: "/trace/wide-turn?view=story", name: "turn-electron", ready: `${PAINTED} && !!document.querySelector('.st-steps')` },
  { hash: "/trace/wide-turn?view=timeline", name: "turn-timeline-electron", ready: `${PAINTED} && !!document.querySelector('.wf-body') && !!document.querySelector('.row [data-bar]')` },
]

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

let updateState = IDLE
function stubIpc() {
  ipcMain.handle("desktop:getUpdate", () => updateState)
  ipcMain.handle("desktop:checkUpdates", () => updateState)
  ipcMain.handle("desktop:engineStatus", () => ({ state: "idle" }))
  ipcMain.handle("desktop:getOpenAtLogin", () => false)
  ipcMain.handle("desktop:setOpenAtLogin", () => false)
  ipcMain.handle("desktop:openSettings", () => true)
  ipcMain.handle("desktop:openDashboard", () => true)
  ipcMain.handle("desktop:restartToUpdate", () => true)
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

async function loadHash(win, hash, theme, ready) {
  nativeTheme.themeSource = theme
  const url = `${ORIGIN}/index.html`
  const loaded = new Promise((resolve) => {
    const t = setTimeout(resolve, 8000)
    win.webContents.once("did-finish-load", () => {
      clearTimeout(t)
      resolve()
    })
  })
  win.loadURL(url).then(
    () => {},
    (err) => console.warn("loadURL rejected", url, err),
  )
  await loaded
  await waitFor(win, "!!document.querySelector('#root')")
  await exec(
    win,
    `localStorage.setItem("aftertrace-theme", ${JSON.stringify(theme)});
     localStorage.removeItem("aftertrace-resolved");
     document.documentElement.dataset.theme = ${JSON.stringify(theme)};
     if (location.hash !== ${JSON.stringify("#" + hash)}) location.hash = ${JSON.stringify("#" + hash)};
     true`,
  )
  await waitFor(
    win,
    `document.documentElement.dataset.theme === ${JSON.stringify(theme)} && (${ready})`,
  )
  await sleep(600)
}

async function savePng(win, dest) {
  // First capture can be a stale compositor frame of the skeleton.
  await win.webContents.capturePage()
  await sleep(120)
  const img = await win.capturePage()
  const buf = img.toPNG()
  fs.writeFileSync(dest, buf)
  console.log(`wrote ${dest} (${img.getSize().width}x${img.getSize().height}, ${buf.length} bytes)`)
  if (buf.length < 40_000 && !/settings-electron/.test(dest)) {
    throw new Error(`shot too small (likely skeleton): ${dest} ${buf.length} bytes`)
  }
  return dest
}

function stitchGif(frames, dest) {
  const pattern = path.join(OUT, "rec-%d.png")
  const mp4 = dest.replace(/\.gif$/, ".mp4")
  const ffGif = spawnSync(
    "ffmpeg",
    ["-y", "-start_number", "1", "-framerate", "1", "-i", pattern, "-vf", "fps=1,scale=720:-1:flags=lanczos", "-loop", "0", dest],
    { encoding: "utf8" },
  )
  const ffMp4 = spawnSync(
    "ffmpeg",
    ["-y", "-start_number", "1", "-framerate", "1", "-i", pattern, "-vf", "scale=720:-2", "-pix_fmt", "yuv420p", mp4],
    { encoding: "utf8" },
  )
  if (ffGif.status === 0) console.log("ffmpeg gif", dest, ffGif.stderr.slice(-200))
  if (ffMp4.status === 0) console.log("ffmpeg mp4", mp4)
  if (!fs.existsSync(dest) || fs.statSync(dest).size < 10_000) {
    const py = spawnSync(process.env.SHOT_PYTHON || "python3", ["-"], {
      input: `
from pathlib import Path
from PIL import Image
frames = [Image.open(p).convert("P", palette=Image.ADAPTIVE, colors=64) for p in ${JSON.stringify(frames)}]
out = Path(${JSON.stringify(dest)})
frames[0].save(out, save_all=True, append_images=frames[1:], duration=1000, loop=0, optimize=True)
print("pillow gif", out.stat().st_size)
`,
      encoding: "utf8",
    })
    console.log("pillow gif", py.status, py.stdout, py.stderr)
  }
  if (!fs.existsSync(dest) || fs.statSync(dest).size < 10_000) {
    throw new Error(`failed to write ${dest} (need a real gif, not a stub)`)
  }
  console.log("wrote", dest, fs.statSync(dest).size)
}

app.commandLine.appendSwitch("disable-http-cache")
app.commandLine.appendSwitch("enable-features", "OverlayScrollbar")
setTimeout(() => {
  console.error("ci-window-shots: global timeout")
  app.exit(1)
}, 240_000).unref()

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
    win.webContents.on("did-fail-load", (_e, code, desc, failedUrl, isMain) => {
      console.warn("did-fail-load", { code, desc, failedUrl, isMain })
    })
    for (const size of SIZES) {
      win.setContentSize(size.w, size.h)
      await sleep(150)
      for (const page of PAGES) {
        for (const theme of ["light", "dark"]) {
          await loadHash(win, page.hash, theme, page.ready)
          await savePng(win, path.join(OUT, `${page.name}-${size.tag}-${theme}.png`))
        }
      }
    }

    const setWin = new BrowserWindow({
      ...settingsWindowOptions(),
      show: true,
      paintWhenInitiallyHidden: true,
    })
    attachGuards(setWin, { fallbackWaiting: false })
    updateState = READY
    setWin.setContentSize(720, 640)
    await loadHash(setWin, "/settings?tab=updates", "light", "!!document.querySelector('[data-settings=updates]')")
    await savePng(setWin, path.join(OUT, "settings-electron-720-light.png"))
    await loadHash(setWin, "/settings?tab=updates", "dark", "!!document.querySelector('[data-settings=updates]')")
    await savePng(setWin, path.join(OUT, "settings-electron-720-dark.png"))
    setWin.close()

    win.setContentSize(1024, 720)
    await loadHash(
      win,
      "/trace/509cb3acac23db7c6e9b7d180a474268?long=1",
      "light",
      `${PAINTED} && !!document.querySelector('.step-group')`,
    )
    await exec(win, `document.querySelector('.step-group .link')?.click(); true`)
    await waitFor(win, "!!document.querySelector('.st-steps') && !document.querySelector('.step-group')")
    await waitFor(
      win,
      "(() => { const el = document.querySelector('.st-scroll'); return !!(el && el.scrollHeight > el.clientHeight + 40); })()",
    )
    await exec(win, `const el = document.querySelector('.st-scroll'); if (el) el.scrollTop = el.scrollHeight; true`)
    await waitFor(
      win,
      "(() => { const el = document.querySelector('.st-scroll'); return !!(el && el.scrollTop > 40); })()",
    )
    await sleep(250)
    await savePng(win, path.join(OUT, "turn-long-1024-light.png"))

    win.setContentSize(1024, 720)
    await loadHash(win, "/findings", "light", "!!document.querySelector('.fr.sel')")
    const rec1 = path.join(OUT, "rec-1.png")
    const rec2 = path.join(OUT, "rec-2.png")
    const rec3 = path.join(OUT, "rec-3.png")
    await savePng(win, rec1)
    await exec(win, `document.querySelector('.win')?.classList.add('is-inactive'); true`)
    win.blur()
    await sleep(250)
    await savePng(win, rec2)
    win.focus()
    await exec(win, `document.querySelector('.win')?.classList.remove('is-inactive'); true`)
    await exec(win, `document.querySelector('.copy-fix')?.click(); true`)
    await waitFor(win, "!![...document.querySelectorAll('.copy-fix')].some(b => /Copied/.test(b.textContent||''))")
    await savePng(win, rec3)
    stitchGif([rec1, rec2, rec3], path.join(OUT, "selection-focus-copied.gif"))
    fs.copyFileSync(rec1, path.join(OUT, "selection-focus.png"))
    fs.copyFileSync(rec2, path.join(OUT, "selection-inactive.png"))
    fs.copyFileSync(rec3, path.join(OUT, "copied-confirm.png"))

    app.exit(0)
  })
  .catch((err) => {
    console.error(err)
    app.exit(1)
  })
