"use strict"

const fs = require("fs")
const path = require("path")

function sidecarPath(context, engineName) {
  if (context.electronPlatformName === "darwin") {
    const appName = `${context.packager.appInfo.productFilename}.app`
    return path.join(context.appOutDir, appName, "Contents", "Resources", "engine", engineName)
  }
  return path.join(context.appOutDir, "resources", "engine", engineName)
}

exports.default = async function afterPack(context) {
  const engineName = context.electronPlatformName === "win32" ? "aftertrace.exe" : "aftertrace"
  const sidecar = sidecarPath(context, engineName)
  if (!fs.existsSync(sidecar)) {
    throw new Error(`Packaged Go engine missing at ${sidecar}`)
  }
  if (context.electronPlatformName !== "win32") {
    fs.chmodSync(sidecar, 0o755)
  }
  const st = fs.statSync(sidecar)
  if (!st.size) throw new Error(`Packaged Go engine is empty: ${sidecar}`)
}
