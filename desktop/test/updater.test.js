"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const { EventEmitter } = require("node:events")
const { createUpdater, feedCompatible } = require("../src/updater")

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
  assert.equal(updater.requestInstall({ relaunch: true }), true)
  assert.deepEqual(auto.installs, [{ silent: false, relaunch: true }])
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

test("manual Download does not quitAndInstall", async () => {
  const auto = mockAuto({
    version: "0.5.4",
    files: [{ url: "Aftertrace-mac-arm64.zip" }],
  })
  const d = dialog()
  d.nextResponse = 0
  const updater = createUpdater({ autoUpdater: auto, getVersion: () => "0.5.0", dialog: d })
  const st = await updater.check({ interactive: true })
  assert.equal(st.status, "ready")
  assert.equal(auto.installs.length, 0)
  assert.equal(d.boxes.length, 1)
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

test("Later on available does not download", async () => {
  const auto = mockAuto({
    version: "0.5.4",
    files: [{ url: "Aftertrace-mac-arm64.zip" }],
  })
  const d = dialog()
  d.nextResponse = 1
  const updater = createUpdater({
    autoUpdater: auto,
    getVersion: () => "0.5.0",
    dialog: d,
    platform: "darwin",
    arch: "arm64",
  })
  const st = await updater.check({ interactive: true })
  assert.equal(st.status, "available")
  assert.equal(auto.downloads, 0)
  assert.equal(auto.installs.length, 0)
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

test("Later then a background check downloads without a second feed inspect", async () => {
  const auto = mockAuto({
    version: "0.5.4",
    files: [{ url: "Aftertrace-mac-arm64.zip" }],
  })
  const d = dialog()
  d.nextResponse = 1
  const updater = createUpdater({
    autoUpdater: auto,
    getVersion: () => "0.5.0",
    dialog: d,
    platform: "darwin",
    arch: "arm64",
  })
  const later = await updater.check({ interactive: true })
  assert.equal(later.status, "available")
  assert.equal(auto.downloads, 0)
  const st = await updater.check({ interactive: false })
  assert.equal(st.status, "ready")
  assert.equal(auto.checks, 1)
  assert.equal(auto.downloads, 1)
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

test("requestInstall is a no-op until ready", async () => {
  const auto = mockAuto({
    version: "0.5.4",
    files: [{ url: "Aftertrace-mac-arm64.zip" }],
  })
  const updater = createUpdater({ autoUpdater: auto, getVersion: () => "0.5.0", dialog: dialog() })
  assert.equal(updater.requestInstall({ relaunch: true }), false)
  assert.equal(auto.installs.length, 0)
})
