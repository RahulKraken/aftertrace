"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const { EventEmitter } = require("node:events")
const { createUpdater, feedCompatible, HOUR_MS, LAUNCH_DELAY_MS, ONLINE_POLL_MS } = require("../src/updater")

function mockAuto(info) {
  const auto = new EventEmitter()
  auto.autoDownload = true
  auto.autoInstallOnAppQuit = false
  auto.autoRunAppAfterInstall = true
  auto.allowDowngrade = true
  auto.checks = 0
  auto.downloads = 0
  auto.installs = []
  auto.checkForUpdates = async () => {
    auto.checks += 1
    return { updateInfo: info }
  }
  auto.downloadUpdate = async () => {
    auto.downloads += 1
    auto.emit("update-downloaded", info)
  }
  auto.quitAndInstall = (silent, relaunch) => {
    auto.installs.push({ silent, relaunch })
  }
  return auto
}

function dialog() {
  const d = { boxes: [] }
  d.showMessageBox = async (opts) => {
    d.boxes.push(opts)
    return { response: d.nextResponse || 0 }
  }
  return d
}

test("0.5.0 app sees a 0.5.4 arm64 feed as an update and does not quit", async () => {
  const auto = mockAuto({
    version: "0.5.4",
    files: [{ url: "Aftertrace-mac-arm64.zip" }],
  })
  const updater = createUpdater({
    autoUpdater: auto,
    getVersion: () => "0.5.0",
    dialog: dialog(),
  })
  const st = await updater.check({ interactive: false })
  assert.equal(st.status, "ready")
  assert.equal(st.version, "0.5.4")
  assert.equal(auto.checks, 1)
  assert.equal(auto.downloads, 1)
  assert.equal(auto.installs.length, 0)
  assert.equal(auto.autoDownload, false)
  assert.equal(auto.autoInstallOnAppQuit, true)
  assert.equal(auto.autoRunAppAfterInstall, false)
  assert.equal(auto.allowDowngrade, false)
})

test("Restart to update is user-triggered", async () => {
  const auto = mockAuto({
    version: "0.5.4",
    files: [{ url: "Aftertrace-mac-arm64.zip" }],
  })
  const updater = createUpdater({ autoUpdater: auto, getVersion: () => "0.5.0", dialog: dialog() })
  await updater.check({ interactive: false })
  assert.equal(auto.autoRunAppAfterInstall, false)
  assert.equal(updater.requestInstall({ relaunch: true }), true)
  assert.equal(auto.autoRunAppAfterInstall, true)
  assert.deepEqual(auto.installs, [{ silent: false, relaunch: true }])
})

test("old Mac path: autoRunAppAfterInstall false means quitAndInstall will not relaunch", async () => {
  const auto = mockAuto({
    version: "0.5.5",
    files: [{ url: "Aftertrace-mac-arm64.zip" }],
  })
  const updater = createUpdater({ autoUpdater: auto, getVersion: () => "0.5.4", dialog: dialog() })
  await updater.check({ interactive: false })
  // 0.5.4/0.5.5 called quitAndInstall(false, true) without flipping the flag.
  // electron-updater's MacUpdater then calls app.quit() instead of
  // nativeUpdater.quitAndInstall(), so ShipIt replaces the app and stops.
  assert.equal(auto.autoRunAppAfterInstall, false)
  auto.quitAndInstall(false, true)
  assert.equal(auto.autoRunAppAfterInstall, false)
  assert.deepEqual(auto.installs, [{ silent: false, relaunch: true }])
})

test("quit-to-install leaves autoRunAppAfterInstall false", async () => {
  const auto = mockAuto({
    version: "0.5.4",
    files: [{ url: "Aftertrace-mac-arm64.zip" }],
  })
  const updater = createUpdater({ autoUpdater: auto, getVersion: () => "0.5.0", dialog: dialog() })
  await updater.check({ interactive: false })
  assert.equal(updater.requestInstall({ relaunch: false }), true)
  assert.equal(auto.autoRunAppAfterInstall, false)
  assert.deepEqual(auto.installs, [{ silent: false, relaunch: false }])
})

test("same version is current, not a download", async () => {
  const auto = mockAuto({ version: "0.5.0", files: [{ url: "Aftertrace-mac-arm64.zip" }] })
  const updater = createUpdater({ autoUpdater: auto, getVersion: () => "0.5.0", dialog: dialog() })
  const st = await updater.check({ interactive: false })
  assert.equal(st.status, "current")
  assert.equal(auto.downloads, 0)
})

test("does not downgrade", async () => {
  const auto = mockAuto({ version: "0.4.9", files: [{ url: "Aftertrace-mac-arm64.zip" }] })
  const updater = createUpdater({ autoUpdater: auto, getVersion: () => "0.5.4", dialog: dialog() })
  const st = await updater.check({ interactive: false })
  assert.equal(st.status, "current")
  assert.equal(auto.downloads, 0)
})

test("interactive Check downloads with no Download/Later prompt", async () => {
  const auto = mockAuto({
    version: "0.5.4",
    files: [{ url: "Aftertrace-mac-arm64.zip" }],
  })
  const d = dialog()
  const updater = createUpdater({ autoUpdater: auto, getVersion: () => "0.5.0", dialog: d })
  const st = await updater.check({ interactive: true })
  assert.equal(st.status, "ready")
  assert.equal(auto.installs.length, 0)
  assert.equal(auto.downloads, 1)
  assert.equal(
    d.boxes.filter((box) => /available/i.test(box.message) || (box.buttons || []).includes("Download")).length,
    0,
  )
})

test("offline check is an error, not a crash", async () => {
  const auto = mockAuto({ version: "0.5.4" })
  auto.checkForUpdates = async () => {
    throw new Error("ENOTFOUND github.com")
  }
  const updater = createUpdater({ autoUpdater: auto, getVersion: () => "0.5.0", dialog: dialog() })
  const st = await updater.check({ interactive: false })
  assert.equal(st.status, "error")
  assert.match(st.error, /ENOTFOUND/)
})

test("arm64 feed without arm64 zip is rejected", () => {
  const r = feedCompatible({ files: [{ url: "Aftertrace-mac-x64.zip" }] }, "arm64", "darwin")
  assert.equal(r.ok, false)
})

test("arm64 zip is compatible", () => {
  const r = feedCompatible({ files: [{ url: "Aftertrace-mac-arm64.zip" }] }, "arm64", "darwin")
  assert.equal(r.ok, true)
})

test("linux x64 is not treated as Intel Mac", () => {
  const r = feedCompatible({ files: [{ url: "Aftertrace-linux.AppImage" }] }, "x64", "linux")
  assert.equal(r.ok, true)
})

test("darwin x64 is not a consumer target", () => {
  const r = feedCompatible({ files: [{ url: "Aftertrace-mac-x64.zip" }] }, "x64", "darwin")
  assert.equal(r.ok, false)
})

test("background check never shows a dialog", async () => {
  const auto = mockAuto({
    version: "0.5.4",
    files: [{ url: "Aftertrace-mac-arm64.zip" }],
  })
  const d = dialog()
  const updater = createUpdater({
    autoUpdater: auto,
    getVersion: () => "0.5.0",
    dialog: d,
    platform: "darwin",
    arch: "arm64",
  })
  const st = await updater.check({ interactive: false })
  assert.equal(st.status, "ready")
  assert.equal(d.boxes.length, 0)
})

test("failed download is a retryable error, app stays running", async () => {
  const auto = mockAuto({
    version: "0.5.4",
    files: [{ url: "Aftertrace-mac-arm64.zip" }],
  })
  auto.downloadUpdate = async () => {
    throw new Error("cancelled")
  }
  const updater = createUpdater({
    autoUpdater: auto,
    getVersion: () => "0.5.0",
    dialog: dialog(),
    platform: "darwin",
    arch: "arm64",
  })
  const st = await updater.check({ interactive: false })
  assert.equal(st.status, "error")
  assert.match(st.error, /cancelled/)
  assert.equal(auto.installs.length, 0)
})

test("ready state offers Restart, Later does not install", async () => {
  const auto = mockAuto({
    version: "0.5.4",
    files: [{ url: "Aftertrace-mac-arm64.zip" }],
  })
  const d = dialog()
  const updater = createUpdater({ autoUpdater: auto, getVersion: () => "0.5.0", dialog: d })
  await updater.check({ interactive: false })
  d.nextResponse = 1
  const st = await updater.check({ interactive: true })
  assert.equal(st.status, "ready")
  assert.equal(st.restart, undefined)
  assert.equal(auto.installs.length, 0)
})

test("interactive check during an in-flight download does not start a second one", async () => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const auto = mockAuto({
    version: "0.5.4",
    files: [{ url: "Aftertrace-mac-arm64.zip" }],
  })
  auto.downloadUpdate = async () => {
    auto.downloads += 1
    await gate
    auto.emit("update-downloaded", { version: "0.5.4" })
  }
  const d = dialog()
  const updater = createUpdater({
    autoUpdater: auto,
    getVersion: () => "0.5.0",
    dialog: d,
    platform: "darwin",
    arch: "arm64",
  })
  const bg = updater.check({ interactive: false })
  while (auto.downloads === 0) await new Promise((r) => setImmediate(r))
  const fg = updater.check({ interactive: true })
  release()
  const [a, b] = await Promise.all([bg, fg])
  assert.equal(auto.checks, 1)
  assert.equal(auto.downloads, 1)
  assert.equal(a.status, "ready")
  assert.equal(b.status, "ready")
  assert.equal(auto.installs.length, 0)
  assert.ok(d.boxes.some((box) => /Downloading/i.test(box.message)))
})

test("notification click fires the hook", async () => {
  const auto = mockAuto({
    version: "0.5.7",
    files: [{ url: "Aftertrace-mac-arm64.zip" }],
  })
  let clicks = 0
  const notes = []
  const updater = createUpdater({
    autoUpdater: auto,
    getVersion: () => "0.5.6",
    dialog: dialog(),
    onNotifyClick: () => {
      clicks += 1
    },
    notify: (opts) => {
      notes.push(opts)
      return { on() {} }
    },
    persist: { load: () => ({}), save: () => {} },
  })
  await updater.check({ interactive: false })
  notes[0].onClick()
  assert.equal(clicks, 1)
})

test("records last-checked time", async () => {
  const auto = mockAuto({ version: "0.5.6", files: [{ url: "Aftertrace-mac-arm64.zip" }] })
  const saved = []
  const updater = createUpdater({
    autoUpdater: auto,
    getVersion: () => "0.5.6",
    dialog: dialog(),
    persist: {
      load: () => ({}),
      save: (next) => saved.push(next),
    },
    notify: () => {},
  })
  const st = await updater.check({ interactive: false })
  assert.equal(st.status, "current")
  assert.ok(st.checkedAt)
  assert.ok(saved.some((row) => row.updateCheckedAt === st.checkedAt))
})

test("notifies once per version when ready", async () => {
  const auto = mockAuto({
    version: "0.5.7",
    files: [{ url: "Aftertrace-mac-arm64.zip" }],
  })
  const notes = []
  const saved = []
  const updater = createUpdater({
    autoUpdater: auto,
    getVersion: () => "0.5.6",
    dialog: dialog(),
    notify: (opts) => {
      notes.push(opts)
      return { on() {} }
    },
    persist: {
      load: () => ({ notifiedUpdateVersion: "", updateCheckedAt: 0 }),
      save: (next) => saved.push(next),
    },
  })
  await updater.check({ interactive: false })
  assert.equal(notes.length, 1)
  assert.equal(notes[0].title, "Aftertrace v0.5.7 is ready")
  await updater.check({ interactive: false })
  assert.equal(notes.length, 1)
  assert.ok(saved.some((row) => row.notifiedUpdateVersion === "0.5.7"))
})

test("does not notify again for a version already recorded", async () => {
  const auto = mockAuto({
    version: "0.5.7",
    files: [{ url: "Aftertrace-mac-arm64.zip" }],
  })
  const notes = []
  const updater = createUpdater({
    autoUpdater: auto,
    getVersion: () => "0.5.6",
    dialog: dialog(),
    notify: (opts) => notes.push(opts),
    persist: {
      load: () => ({ notifiedUpdateVersion: "0.5.7", updateCheckedAt: 1 }),
      save: () => {},
    },
  })
  await updater.check({ interactive: false })
  assert.equal(notes.length, 0)
})

test("background checks run on launch and hourly, once", async () => {
  const auto = mockAuto({
    version: "0.5.7",
    files: [{ url: "Aftertrace-mac-arm64.zip" }],
  })
  const timeouts = []
  const intervals = []
  const updater = createUpdater({
    autoUpdater: auto,
    getVersion: () => "0.5.6",
    dialog: dialog(),
    persist: { load: () => ({}), save: () => {} },
    notify: () => {},
    setTimeout: (fn, ms) => {
      timeouts.push({ fn, ms })
      return { unref() {} }
    },
    setInterval: (fn, ms) => {
      intervals.push({ fn, ms })
      return { unref() {} }
    },
  })
  updater.startBackgroundChecks()
  updater.startBackgroundChecks()
  assert.equal(timeouts.length, 1)
  assert.equal(timeouts[0].ms, LAUNCH_DELAY_MS)
  assert.ok(intervals.some((row) => row.ms === HOUR_MS))
  await timeouts[0].fn()
  assert.equal(auto.downloads, 1)
  assert.equal(updater.getState().status, "ready")
})

test("resume after offline error inspects again", async () => {
  const auto = mockAuto({ version: "0.5.7", files: [{ url: "Aftertrace-mac-arm64.zip" }] })
  let n = 0
  auto.checkForUpdates = async () => {
    auto.checks += 1
    n += 1
    if (n === 1) throw new Error("ENOTFOUND github.com")
    return { updateInfo: { version: "0.5.7", files: [{ url: "Aftertrace-mac-arm64.zip" }] } }
  }
  const pm = new EventEmitter()
  const timeouts = []
  const updater = createUpdater({
    autoUpdater: auto,
    getVersion: () => "0.5.6",
    dialog: dialog(),
    persist: { load: () => ({}), save: () => {} },
    notify: () => {},
    setTimeout: (fn, ms) => {
      timeouts.push({ fn, ms })
      return { unref() {} }
    },
    setInterval: () => ({ unref() {} }),
    powerMonitor: pm,
  })
  updater.startBackgroundChecks()
  await timeouts[0].fn()
  assert.equal(updater.getState().status, "error")
  pm.emit("resume")
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(updater.getState().status, "ready")
  assert.equal(auto.checks, 2)
})

test("unlock-screen after sleep inspects again", async () => {
  const auto = mockAuto({ version: "0.5.7", files: [{ url: "Aftertrace-mac-arm64.zip" }] })
  let n = 0
  auto.checkForUpdates = async () => {
    auto.checks += 1
    n += 1
    if (n === 1) throw new Error("ENOTFOUND github.com")
    return { updateInfo: { version: "0.5.7", files: [{ url: "Aftertrace-mac-arm64.zip" }] } }
  }
  const pm = new EventEmitter()
  const timeouts = []
  const seen = []
  const updater = createUpdater({
    autoUpdater: auto,
    getVersion: () => "0.5.6",
    dialog: dialog(),
    persist: { load: () => ({}), save: () => {} },
    notify: () => {},
    setTimeout: (fn, ms) => {
      timeouts.push({ fn, ms })
      return { unref() {} }
    },
    setInterval: () => ({ unref() {} }),
    powerMonitor: pm,
  })
  updater.subscribe((st) => seen.push(st.status))
  updater.startBackgroundChecks()
  await timeouts[0].fn()
  assert.equal(updater.getState().status, "error")
  pm.emit("unlock-screen")
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(updater.getState().status, "ready")
  assert.ok(seen.includes("ready"))
  assert.equal(auto.installs.length, 0)
})

test("coming back online starts a check", async () => {
  const auto = mockAuto({ version: "0.5.7", files: [{ url: "Aftertrace-mac-arm64.zip" }] })
  let online = false
  const intervals = []
  const updater = createUpdater({
    autoUpdater: auto,
    getVersion: () => "0.5.6",
    dialog: dialog(),
    persist: { load: () => ({}), save: () => {} },
    notify: () => {},
    setTimeout: () => ({ unref() {} }),
    setInterval: (fn, ms) => {
      intervals.push({ fn, ms })
      return { unref() {} }
    },
    net: { isOnline: () => online },
  })
  updater.startBackgroundChecks()
  const poll = intervals.find((row) => row.ms === ONLINE_POLL_MS)
  assert.ok(poll)
  poll.fn()
  assert.equal(auto.checks, 0)
  online = true
  await poll.fn()
  assert.equal(auto.downloads, 1)
  assert.equal(updater.getState().status, "ready")
})

test("retry after an offline error inspects again", async () => {
  const auto = mockAuto({
    version: "0.5.4",
    files: [{ url: "Aftertrace-mac-arm64.zip" }],
  })
  let n = 0
  auto.checkForUpdates = async () => {
    auto.checks += 1
    n += 1
    if (n === 1) throw new Error("ENOTFOUND github.com")
    return { updateInfo: { version: "0.5.4", files: [{ url: "Aftertrace-mac-arm64.zip" }] } }
  }
  const updater = createUpdater({
    autoUpdater: auto,
    getVersion: () => "0.5.0",
    dialog: dialog(),
    platform: "darwin",
    arch: "arm64",
  })
  const err = await updater.check({ interactive: false })
  assert.equal(err.status, "error")
  const st = await updater.check({ interactive: false })
  assert.equal(st.status, "ready")
  assert.equal(auto.checks, 2)
  assert.equal(auto.downloads, 1)
})

test("localhost 127.0.0.1 feed is the only generic override", () => {
  const auto = mockAuto({
    version: "0.5.5",
    files: [{ url: "Aftertrace-mac-arm64.zip" }],
  })
  auto.feed = null
  auto.setFeedURL = (opts) => {
    auto.feed = opts
  }
  const updater = createUpdater({
    autoUpdater: auto,
    getVersion: () => "0.5.4",
    dialog: dialog(),
    feedUrl: "http://127.0.0.1:8765/",
  })
  updater.wire()
  assert.deepEqual(auto.feed, { provider: "generic", url: "http://127.0.0.1:8765/" })

  const blockedAuto = mockAuto({ version: "0.5.5" })
  blockedAuto.setFeedURL = (opts) => {
    blockedAuto.feed = opts
  }
  const blocked = createUpdater({
    autoUpdater: blockedAuto,
    getVersion: () => "0.5.4",
    dialog: dialog(),
    feedUrl: "https://github.com/RahulKraken/aftertrace/releases",
  })
  blocked.wire()
  assert.equal(blockedAuto.feed, undefined)
})

test("a missing Notification API does not fail a silent download", async () => {
  const auto = mockAuto({
    version: "0.5.7",
    files: [{ url: "Aftertrace-mac-arm64.zip" }],
  })
  const d = dialog()
  const updater = createUpdater({
    autoUpdater: auto,
    getVersion: () => "0.5.6",
    dialog: d,
    persist: { load: () => ({}), save: () => {} },
  })
  const st = await updater.check({ interactive: false })
  assert.equal(st.status, "ready")
  assert.equal(d.boxes.length, 0)
  assert.equal(auto.downloads, 1)
})

test("requestInstall is a no-op until ready", async () => {
  const auto = mockAuto({
    version: "0.5.4",
    files: [{ url: "Aftertrace-mac-arm64.zip" }],
  })
  const updater = createUpdater({ autoUpdater: auto, getVersion: () => "0.5.0", dialog: dialog() })
  assert.equal(updater.requestInstall({ relaunch: true }), false)
  assert.equal(auto.installs.length, 0)
})
