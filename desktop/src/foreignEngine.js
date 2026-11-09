"use strict"

const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawnSync } = require("child_process")
const { displayVersion, versionsMatch } = require("./releaseVersion")

const LAUNCHD_LABEL = "dev.aftertrace"
const SYSTEMD_UNIT = "aftertrace.service"

function launchdPlistPath(home = os.homedir()) {
  return path.join(home, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`)
}

function launchdDomain(uid) {
  return `gui/${uid}/${LAUNCHD_LABEL}`
}

function isForeignOccupant(occ, expectedVersion) {
  if (!occ) return false
  if (!expectedVersion) return Boolean(occ.version && occ.version !== "unknown")
  if (occ.version && occ.version !== "unknown" && !versionsMatch(occ.version, expectedVersion)) return true
  if (occ.service === "launchd" || occ.service === "systemd") return true
  return false
}

function occupantError(occ) {
  const ver = displayVersion(occ && occ.version) || "an older Aftertrace"
  return (
    `${ver} is already serving on this machine (ports 7311/4317/4318 or the DuckDB file). ` +
    `The menu-bar app will stop the old login service and start its own engine. Your database is kept.`
  )
}

function migrateLegacyService({
  platform = process.platform,
  home = os.homedir(),
  uid = typeof process.getuid === "function" ? process.getuid() : 0,
  spawnSyncFn = spawnSync,
  fsFn = fs,
} = {}) {
  const notes = []
  if (platform === "darwin") {
    const domain = launchdDomain(uid)
    const boot = spawnSyncFn("launchctl", ["bootout", domain], { encoding: "utf8" })
    notes.push({
      cmd: ["launchctl", "bootout", domain],
      status: boot.status,
      stderr: String((boot && boot.stderr) || "").slice(0, 400),
    })
    const plist = launchdPlistPath(home)
    if (fsFn.existsSync(plist)) {
      try {
        fsFn.unlinkSync(plist)
        notes.push({ removed: plist })
      } catch (err) {
        notes.push({ removeFailed: plist, error: err.message })
        return { ok: false, notes, error: `Could not remove ${plist}: ${err.message}` }
      }
    }
    return { ok: true, notes, migrated: "launchd" }
  }
  if (platform === "linux") {
    const off = spawnSyncFn("systemctl", ["--user", "disable", "--now", SYSTEMD_UNIT], { encoding: "utf8" })
    notes.push({
      cmd: ["systemctl", "--user", "disable", "--now", SYSTEMD_UNIT],
      status: off.status,
      stderr: String((off && off.stderr) || "").slice(0, 400),
    })
    return { ok: true, notes, migrated: "systemd" }
  }
  return { ok: true, notes, migrated: "" }
}

module.exports = {
  LAUNCHD_LABEL,
  SYSTEMD_UNIT,
  launchdPlistPath,
  launchdDomain,
  isForeignOccupant,
  occupantError,
  migrateLegacyService,
}
