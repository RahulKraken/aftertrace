"use strict"

const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")

function sidecarPath(context) {
  const appName = `${context.packager.appInfo.productFilename}.app`
  return path.join(context.appOutDir, appName, "Contents", "Resources", "engine", "aftertrace")
}

function codesignOut(args) {
  const r = spawnSync("codesign", args, { encoding: "utf8" })
  return {
    status: r.status,
    text: `${r.stdout || ""}${r.stderr || ""}`,
  }
}

function isSigned(p) {
  const r = codesignOut(["-v", p])
  return r.status === 0
}

function signingIdentity(appBundle) {
  const r = codesignOut(["-dv", "--verbose=4", appBundle])
  if (/code object is not signed/i.test(r.text)) return null
  const m = r.text.match(/Authority=(Developer ID Application: .+)/)
  return m ? m[1] : null
}

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return
  const appName = `${context.packager.appInfo.productFilename}.app`
  const appBundle = path.join(context.appOutDir, appName)
  const sidecar = sidecarPath(context)
  if (!fs.existsSync(sidecar)) {
    throw new Error(`Go engine missing after sign at ${sidecar}`)
  }

  const identity = signingIdentity(appBundle)
  if (!identity) {
    // Unsigned PR / local build: nothing to nest-sign.
    return
  }

  const entitlements = path.join(__dirname, "..", "resources", "entitlements.mac.plist")
  const sign = codesignOut([
    "--force",
    "--options",
    "runtime",
    "--timestamp",
    "--entitlements",
    entitlements,
    "--sign",
    identity,
    sidecar,
  ])
  if (sign.status !== 0) {
    throw new Error(`Failed to sign Go sidecar:\n${sign.text}`)
  }
  if (!isSigned(sidecar)) {
    throw new Error(`Go sidecar is not signed after codesign: ${sidecar}`)
  }
}
