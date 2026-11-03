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
  return codesignOut(["-v", p]).status === 0
}

function signingIdentity(appBundle) {
  const r = codesignOut(["-dv", "--verbose=4", appBundle])
  if (/code object is not signed/i.test(r.text)) return null
  const m = r.text.match(/Authority=(Developer ID Application: .+)/)
  return m ? m[1] : null
}

function sign(p, identity, entitlements) {
  const args = ["--force", "--options", "runtime", "--timestamp", "--sign", identity]
  if (entitlements) args.push("--entitlements", entitlements)
  args.push(p)
  const result = codesignOut(args)
  if (result.status !== 0) {
    throw new Error(`codesign failed for ${p}:\n${result.text}`)
  }
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

  const appEntitlements = path.join(__dirname, "..", "resources", "entitlements.mac.plist")
  const engineEntitlements = path.join(__dirname, "..", "resources", "entitlements.mac.engine.plist")

  // Inside-out: sidecar first (no JIT), then re-seal the app bundle so the
  // nested signature is part of the hash. --deep is not used.
  sign(sidecar, identity, engineEntitlements)
  if (!isSigned(sidecar)) {
    throw new Error(`Go sidecar is not signed after codesign: ${sidecar}`)
  }
  sign(appBundle, identity, appEntitlements)
  if (!isSigned(appBundle)) {
    throw new Error(`App bundle is not signed after re-seal: ${appBundle}`)
  }
}

exports.sidecarPath = sidecarPath
exports.signingIdentity = signingIdentity
