"use strict"

const fs = require("fs")
const path = require("path")
const { archName } = require("./mac-arch.cjs")

const DESKTOP = path.join(__dirname, "..")

function engineFileName(electronPlatformName) {
  return electronPlatformName === "win32" ? "aftertrace.exe" : "aftertrace"
}

function candidates(root, electronPlatformName, arch) {
  const name = engineFileName(electronPlatformName)
  const list = []
  if (electronPlatformName === "darwin") {
    const chip = archName(arch)
    list.push(path.join(root, "resources", "engine-arch", `darwin-${chip}`, name))
  }
  list.push(path.join(root, "resources", "engine", name))
  list.push(path.join(root, "..", name))
  return list
}

function selectEngine(root, electronPlatformName, arch) {
  const name = engineFileName(electronPlatformName)
  if (electronPlatformName === "darwin" && archName(arch) === "universal") {
    throw new Error(
      "Universal Mac builds are disabled. Pack arm64 and x64 separately so each DMG ships one Go engine.",
    )
  }
  for (const src of candidates(root, electronPlatformName, arch)) {
    if (src && fs.existsSync(src) && fs.statSync(src).size) return src
  }
  throw new Error(
    `Go engine missing (${name} for ${electronPlatformName}/${archName(arch) || "host"}). ` +
      `Build it first (CGO_ENABLED=1 go build -o ${name} ./cmd/aftertrace) ` +
      `and place it in desktop/resources/engine/ or desktop/resources/engine-arch/.`,
  )
}

function stageEngine(root, electronPlatformName, arch) {
  const name = engineFileName(electronPlatformName)
  const destDir = path.join(root, "resources", "engine")
  const dest = path.join(destDir, name)
  const src = selectEngine(root, electronPlatformName, arch)
  fs.mkdirSync(destDir, { recursive: true })
  if (path.resolve(src) !== path.resolve(dest)) {
    fs.copyFileSync(src, dest)
  }
  if (electronPlatformName !== "win32") fs.chmodSync(dest, 0o755)
  return dest
}

exports.default = async function beforePack(context) {
  stageEngine(DESKTOP, context.electronPlatformName, context.arch)
}

exports.selectEngine = selectEngine
exports.stageEngine = stageEngine
exports.candidates = candidates
exports.engineFileName = engineFileName
