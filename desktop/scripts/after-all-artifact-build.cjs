"use strict"

// electron-builder signs the .apps (CSC_*). This hook notarizes the per-chip
// DMGs and updater zips in parallel, then staples DMGs and the .apps.
// electron-builder's own mac.notarize is always off in CI: it --waits on
// each .app in series and blew the 60-minute job after codesign had already
// succeeded (PR 44, run 42219009955). Skip when secrets are absent.

const fs = require("fs")
const path = require("path")
const { spawn, spawnSync } = require("child_process")
const { canNotarize } = require("./mac-arch.cjs")

const NOTARY_WAIT_SECONDS = 2400

function notarytoolSubmitArgs(file) {
  const wait = [
    "notarytool",
    "submit",
    file,
    "--wait",
    "--timeout",
    String(NOTARY_WAIT_SECONDS),
  ]
  if (process.env.APPLE_API_KEY) {
    return wait.concat([
      "--key",
      process.env.APPLE_API_KEY,
      "--key-id",
      process.env.APPLE_API_KEY_ID,
      "--issuer",
      process.env.APPLE_API_ISSUER,
    ])
  }
  return wait.concat([
    "--apple-id",
    process.env.APPLE_ID,
    "--password",
    process.env.APPLE_APP_SPECIFIC_PASSWORD,
    "--team-id",
    process.env.APPLE_TEAM_ID,
  ])
}

function collectNotarizeTargets(artifactPaths) {
  const seen = new Set()
  const out = []
  for (const p of artifactPaths || []) {
    const base = path.basename(p)
    if (!/^Aftertrace-mac-(arm64|x64)\.(dmg|zip)$/.test(base)) continue
    if (seen.has(base)) continue
    seen.add(base)
    out.push(p)
  }
  return out
}

function collectAppBundles(outDir) {
  if (!outDir) return []
  const apps = []
  let names
  try {
    names = fs.readdirSync(outDir)
  } catch {
    return []
  }
  for (const name of names) {
    const app = path.join(outDir, name, "Aftertrace.app")
    if (fs.existsSync(path.join(app, "Contents"))) apps.push(app)
  }
  return apps
}

function spawnInherit(cmd, args, spawnFn) {
  return new Promise((resolve, reject) => {
    const child = spawnFn(cmd, args, { stdio: "inherit" })
    child.on("error", reject)
    child.on("close", (status, signal) => {
      if (status === 0) resolve()
      else {
        const why = signal ? `signal ${signal}` : `exit ${status}`
        reject(new Error(`${cmd} ${args[0] || ""} ${why}`))
      }
    })
  })
}

function stapleFile(file, spawnSyncFn) {
  const r = spawnSyncFn("xcrun", ["stapler", "staple", file], { encoding: "utf8" })
  if (r.status !== 0) {
    throw new Error(
      `stapler staple failed for ${path.basename(file)}:\n${r.stdout || ""}${r.stderr || ""}`,
    )
  }
}

async function notarizeFiles(files, spawnFn) {
  await Promise.all(
    files.map((file) => {
      process.stdout.write(`notarytool submit --wait ${path.basename(file)}\n`)
      return spawnInherit("xcrun", notarytoolSubmitArgs(file), spawnFn).catch((err) => {
        throw new Error(`notarytool submit failed for ${path.basename(file)}: ${err.message}`)
      })
    }),
  )
}

function writeNotarizedMarker(outDir, writeFileSyncFn = fs.writeFileSync) {
  const marker = path.join(outDir, "Aftertrace-mac-notarized.json")
  writeFileSyncFn(marker, '{"notarized":true}\n')
  return marker
}

function defaultIo() {
  return {
    spawn,
    spawnSync,
    canNotarize,
    writeFileSync: fs.writeFileSync,
    platform: process.platform,
  }
}

async function afterAllArtifactBuild(buildResult, io) {
  const hooks = { ...defaultIo(), ...io }
  if (hooks.platform !== "darwin") return []
  const paths = (buildResult && buildResult.artifactPaths) || []
  const targets = collectNotarizeTargets(paths)
  if (!targets.length) return []
  if (!hooks.canNotarize()) {
    process.stdout.write("DMG/zip notarization skipped: signing or Apple credentials are not set.\n")
    return []
  }
  await notarizeFiles(targets, hooks.spawn)
  const outDir = (buildResult && buildResult.outDir) || path.dirname(targets[0])
  const stapleTargets = targets.filter((p) => p.endsWith(".dmg")).concat(collectAppBundles(outDir))
  for (const file of stapleTargets) {
    process.stdout.write(`stapler staple ${path.basename(file)}\n`)
    stapleFile(file, hooks.spawnSync)
  }
  const marker = writeNotarizedMarker(outDir, hooks.writeFileSync)
  process.stdout.write(`Wrote ${path.basename(marker)}\n`)
  return [marker]
}

exports.default = afterAllArtifactBuild
exports.afterAllArtifactBuild = afterAllArtifactBuild
exports.notarizeFiles = notarizeFiles
exports.notarytoolSubmitArgs = notarytoolSubmitArgs
exports.collectNotarizeTargets = collectNotarizeTargets
exports.collectAppBundles = collectAppBundles
exports.writeNotarizedMarker = writeNotarizedMarker
exports.stapleFile = stapleFile
exports.canNotarize = canNotarize
exports.NOTARY_WAIT_SECONDS = NOTARY_WAIT_SECONDS
