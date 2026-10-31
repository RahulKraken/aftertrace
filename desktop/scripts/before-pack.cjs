"use strict"

const fs = require("fs")
const path = require("path")

const name = process.platform === "win32" ? "aftertrace.exe" : "aftertrace"

exports.default = async function beforePack() {
  const destDir = path.join(__dirname, "..", "resources", "engine")
  const dest = path.join(destDir, name)
  if (fs.existsSync(dest)) return
  const repo = path.join(__dirname, "..", "..", name)
  if (fs.existsSync(repo)) {
    fs.mkdirSync(destDir, { recursive: true })
    fs.copyFileSync(repo, dest)
    if (process.platform !== "win32") fs.chmodSync(dest, 0o755)
    return
  }
  throw new Error(
    `Go engine missing at ${dest}. Build it first (CGO_ENABLED=1 go build -o ${name} ./cmd/aftertrace) and place it in desktop/resources/engine/.`,
  )
}
