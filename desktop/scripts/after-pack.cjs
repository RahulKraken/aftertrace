"use strict"

const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")
const { archName } = require("./mac-arch.cjs")

function sidecarPath(context, engineName) {
  if (context.electronPlatformName === "darwin") {
    const appName = `${context.packager.appInfo.productFilename}.app`
    return path.join(context.appOutDir, appName, "Contents", "Resources", "engine", engineName)
  }
  return path.join(context.appOutDir, "resources", "engine", engineName)
}

function identify(bin) {
  const file = spawnSync("file", ["-b", bin], { encoding: "utf8" })
  const lipo = spawnSync("lipo", ["-info", bin], { encoding: "utf8" })
  return {
    file: `${file.stdout || ""}${file.stderr || ""}`,
    lipo: `${lipo.stdout || ""}${lipo.stderr || ""}`,
  }
}

function assertEngineArch(bin, arch, id) {
  const chip = archName(arch)
  const info = id || identify(bin)
  const blob = `${info.file}\n${info.lipo}`
  if (/Architectures in the fat file/i.test(blob) || /universal binary/i.test(blob)) {
    throw new Error(`Packaged Go engine is fat/universal (wanted ${chip} only): ${bin}\n${blob}`)
  }
  const want = chip === "arm64" ? /arm64/ : chip === "x64" ? /x86_64/ : null
  if (want && !want.test(blob)) {
    throw new Error(`Packaged Go engine is not ${chip}: ${bin}\n${blob}`)
  }
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
  if (context.electronPlatformName === "darwin") {
    assertEngineArch(sidecar, context.arch)
  }
}

exports.sidecarPath = sidecarPath
exports.assertEngineArch = assertEngineArch
exports.identify = identify
