"use strict"

const fs = require("fs")
const { linuxAutostartDir, linuxAutostartFile, execForAutostart } = require("./paths")

function quoteExec(execPath) {
  return `"${String(execPath).replace(/"/g, '\\"')}"`
}

function desktopEntry({ execPath, hidden = true } = {}) {
  const exec = hidden ? `${quoteExec(execPath)} --hidden` : quoteExec(execPath)
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Version=1.0",
    "Name=Aftertrace",
    "Comment=Time, cost and usage for your AI work",
    `Exec=${exec}`,
    "Terminal=false",
    "Categories=Utility;",
    "X-GNOME-Autostart-enabled=true",
    "StartupNotify=false",
    "",
  ].join("\n")
}

function applyLinux(enabled, execPath = execForAutostart()) {
  const file = linuxAutostartFile()
  if (!enabled) {
    try {
      fs.unlinkSync(file)
    } catch (err) {
      if (err && err.code !== "ENOENT") throw err
    }
    return { file, enabled: false }
  }
  fs.mkdirSync(linuxAutostartDir(), { recursive: true })
  fs.writeFileSync(file, desktopEntry({ execPath, hidden: true }))
  return { file, enabled: true }
}

function linuxEnabled() {
  try {
    return fs.existsSync(linuxAutostartFile())
  } catch {
    return false
  }
}

function apply({ enabled, app }) {
  if (process.platform === "linux") {
    applyLinux(enabled)
    return
  }
  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
    openAsHidden: true,
    args: ["--hidden"],
  })
}

function isEnabled(app) {
  if (process.platform === "linux") return linuxEnabled()
  try {
    return Boolean(app.getLoginItemSettings().openAtLogin)
  } catch {
    return false
  }
}

module.exports = { apply, isEnabled, desktopEntry, applyLinux, quoteExec }
