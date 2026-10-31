"use strict"

const { dialog, app } = require("electron")

function getAutoUpdater() {
  // electron-updater is CJS; this keeps the import working under Electron's bundling.
  const mod = require("electron-updater")
  return mod.autoUpdater
}

function wireSilent(autoUpdater) {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.autoRunAppAfterInstall = true
  autoUpdater.on("error", () => {
    // Harmless when no GitHub Release exists yet. No dialog, no extra network.
  })
}

async function checkForUpdates({ interactive = false } = {}) {
  const autoUpdater = getAutoUpdater()
  wireSilent(autoUpdater)
  try {
    const result = await autoUpdater.checkForUpdates()
    const info = result && result.updateInfo
    const latest = info && info.version
    if (!latest || latest === app.getVersion()) {
      if (interactive) {
        await dialog.showMessageBox({
          type: "info",
          message: "Aftertrace is up to date",
          detail: latest
            ? `This is ${app.getVersion()}.`
            : "No newer desktop release is published yet. The app on this machine is unchanged.",
        })
      }
      return { update: false }
    }
    if (!interactive) return { update: true, version: latest }
    const { response } = await dialog.showMessageBox({
      type: "info",
      message: `Aftertrace ${latest} is available`,
      detail: `You have ${app.getVersion()}. Download it from GitHub Releases, or let Aftertrace fetch it.`,
      buttons: ["Download", "Later"],
      defaultId: 0,
      cancelId: 1,
    })
    if (response === 0) {
      await autoUpdater.downloadUpdate()
      autoUpdater.quitAndInstall()
    }
    return { update: true, version: latest }
  } catch (err) {
    if (interactive) {
      await dialog.showMessageBox({
        type: "info",
        message: "No desktop update published yet",
        detail:
          "Aftertrace looked at GitHub Releases and did not find a desktop package. Nothing else left this machine.",
      })
    }
    return { update: false, error: err.message }
  }
}

function startBackgroundChecks() {
  const autoUpdater = getAutoUpdater()
  wireSilent(autoUpdater)
  const run = () => {
    checkForUpdates({ interactive: false }).catch(() => {})
  }
  setTimeout(run, 20_000).unref?.()
  setInterval(run, 4 * 60 * 60 * 1000).unref?.()
}

module.exports = { checkForUpdates, startBackgroundChecks, getAutoUpdater }
