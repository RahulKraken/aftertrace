"use strict"

// electron-builder PackContext.arch is the Arch enum (ia32=0, x64=1,
// armv7l=2, arm64=3, universal=4). Some hooks pass the name as a string.

const ARCH_NAMES = ["ia32", "x64", "armv7l", "arm64", "universal"]

function archName(arch) {
  if (arch == null) return ""
  if (typeof arch === "number") return ARCH_NAMES[arch] || String(arch)
  const s = String(arch)
  if (s === "amd64" || s === "x86_64") return "x64"
  if (s === "aarch64") return "arm64"
  if (/^\d+$/.test(s)) return ARCH_NAMES[Number(s)] || s
  return s
}

function darwinEngineDir(root, arch) {
  return require("path").join(root, "resources", "engine-arch", `darwin-${archName(arch)}`)
}

function canSign() {
  return Boolean(process.env.CSC_LINK)
}

function canNotarize() {
  return canSign() && Boolean(process.env.APPLE_ID || process.env.APPLE_API_KEY)
}

module.exports = { ARCH_NAMES, archName, darwinEngineDir, canSign, canNotarize }
